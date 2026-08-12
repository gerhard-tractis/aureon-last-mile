#!/usr/bin/env bash
# apply-migrations.sh — idempotent migration applier for the QA Postgres (localhost:5433).
#
# Replays packages/database/supabase/migrations/*.sql against the self-hosted QA
# database, tracking applied versions in supabase_migrations.schema_migrations —
# the same schema/table layout the Supabase CLI uses in prod (version text pk,
# name text, statements text[]). The CLI itself is deliberately NOT installed on
# the VPS; this script is the QA-side replacement.
#
# Transaction semantics: each migration file is applied with
#   psql -v ON_ERROR_STOP=1 --single-transaction -f <file>
# i.e. one transaction per file, which matches Supabase CLI behavior closely
# enough for our purposes. Exception: files that contain their own top-level
# BEGIN;/COMMIT; (currently 20260625000001_spec47_pickup_routes_consolidated_reception.sql)
# are applied WITHOUT --single-transaction, because nesting an explicit BEGIN
# inside psql's implicit transaction would emit "there is already a transaction
# in progress" warnings and break the file's own commit points. Such files
# manage their own atomicity.
#
# Tracking rows are inserted with statements = '{}' (empty array). Parity with
# the Supabase CLI is on the `version` column — that is all `supabase migration
# list` compares — so we do not store the per-statement breakdown.
#
# SAFETY: this script refuses to run against anything that is not
# localhost:5433 / 127.0.0.1:5433. The check parses the --db-url string itself,
# so it cannot be bypassed via PGHOST/PGPORT or other env tricks. It also
# rejects libpq multi-host failover lists (comma in the host part) and any URL
# query parameters other than sslmode, because libpq honors ?host=/?port=
# overrides that would silently redirect the connection.
#
# Crash-consistency note: each migration is applied and then recorded in
# schema_migrations as two separate transactions. If this script dies between
# the apply and the tracking INSERT, the next run will attempt to re-apply
# that migration (which may fail on non-idempotent DDL) — inspect and insert
# the tracking row manually in that rare case.
#
# Usage:
#   ./apply-migrations.sh --db-url postgresql://postgres:PASS@localhost:5433/postgres
#   SUPABASE_DB_PASSWORD=... ./apply-migrations.sh            # assembles the URL
#   ./apply-migrations.sh --dry-run [--db-url ...]

set -euo pipefail

QA_HOST_A="localhost"
QA_HOST_B="127.0.0.1"
QA_PORT="5433"

DB_URL=""
DRY_RUN=0

usage() {
  echo "Usage: $0 [--db-url postgresql://user:pass@localhost:5433/db] [--dry-run]" >&2
  echo "       (without --db-url, requires SUPABASE_DB_PASSWORD in the environment)" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --db-url)
      [ $# -ge 2 ] || { echo "ERROR: --db-url requires a value" >&2; exit 1; }
      DB_URL="$2"; shift 2 ;;
    --db-url=*)
      DB_URL="${1#--db-url=}"; shift ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$DB_URL" ]; then
  if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
    echo "ERROR: no --db-url given and SUPABASE_DB_PASSWORD is not set." >&2
    usage
    exit 1
  fi
  DB_URL="postgresql://postgres:${SUPABASE_DB_PASSWORD}@${QA_HOST_A}:${QA_PORT}/postgres"
fi

# ---------------------------------------------------------------------------
# SAFETY GUARD — parse host:port out of the URL string itself and refuse
# anything that is not localhost:5433 / 127.0.0.1:5433. Runs before any DB
# contact. Deliberately independent of PGHOST/PGPORT/PGSERVICE env vars: only
# the literal URL text matters.
# ---------------------------------------------------------------------------
# Reject libpq connection parameters in the query string. libpq honors
# ?host=/?port=/?hostaddr= overrides, which would redirect the connection
# while the URL's authority still reads localhost:5433. Allow only sslmode.
if [ "${DB_URL#*\?}" != "$DB_URL" ]; then
  query="${DB_URL#*\?}"
  IFS='&' read -r -a qparams <<< "$query"
  for qp in "${qparams[@]}"; do
    pname="${qp%%=*}"
    if [ "$pname" != "sslmode" ]; then
      echo "==================================================================" >&2
      echo "REFUSING TO RUN: URL query parameter '${pname}' is not allowed." >&2
      echo "libpq honors ?host=/?port= overrides that can redirect the" >&2
      echo "connection away from the QA database. Only 'sslmode' is permitted." >&2
      echo "==================================================================" >&2
      exit 1
    fi
  done
fi

authority="${DB_URL#*://}"      # strip scheme
authority="${authority%%/*}"    # strip /dbname...
authority="${authority%%\?*}"   # strip ?params (if no dbname)
hostport="${authority##*@}"     # strip user:pass@

# Reject libpq multi-host failover lists (host1:port1,host2:port2,...):
# our parser would only inspect the first entry while psql may connect to any.
case "$hostport" in
  *,*)
    echo "==================================================================" >&2
    echo "REFUSING TO RUN: multi-host failover list detected in '${hostport}'." >&2
    echo "Only a single host (localhost:5433 or 127.0.0.1:5433) is allowed." >&2
    echo "==================================================================" >&2
    exit 1
    ;;
esac

case "$hostport" in
  \[*\]*) # bracketed IPv6 literal — never our QA target
    url_host="${hostport%%]*}"; url_host="${url_host#[}"
    url_port="${hostport##*]}"; url_port="${url_port#:}"
    ;;
  *:*)
    url_host="${hostport%%:*}"
    url_port="${hostport##*:}"
    ;;
  *)
    url_host="$hostport"
    url_port="5432"  # postgres default when the URL omits the port
    ;;
esac

if { [ "$url_host" != "$QA_HOST_A" ] && [ "$url_host" != "$QA_HOST_B" ]; } || [ "$url_port" != "$QA_PORT" ]; then
  echo "==================================================================" >&2
  echo "REFUSING TO RUN: target is '${url_host}:${url_port}'." >&2
  echo "This script may ONLY be pointed at the QA database on" >&2
  echo "${QA_HOST_A}:${QA_PORT} (or ${QA_HOST_B}:${QA_PORT})." >&2
  echo "It will never touch a remote or production database." >&2
  echo "==================================================================" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Locate migrations relative to this script.
# ---------------------------------------------------------------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migrations_dir="${script_dir}/../../packages/database/supabase/migrations"
if [ ! -d "$migrations_dir" ]; then
  echo "ERROR: migrations directory not found: $migrations_dir" >&2
  exit 1
fi
migrations_dir="$(cd "$migrations_dir" && pwd)"

# Sorted (LC_ALL=C) list of migration files.
mapfile -t files < <(cd "$migrations_dir" && LC_ALL=C ls -1 -- *.sql 2>/dev/null | LC_ALL=C sort)
total="${#files[@]}"
if [ "$total" -eq 0 ]; then
  echo "No .sql files found in $migrations_dir — nothing to do."
  exit 0
fi

psql_base=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtX)

# ---------------------------------------------------------------------------
# Read (or in dry-run, try to read) the set of already-applied versions.
# ---------------------------------------------------------------------------
db_reachable=1
applied_versions=""
if [ "$DRY_RUN" -eq 1 ]; then
  # No writes at all in dry-run: don't create schema/table, just try to read.
  if applied_versions="$("${psql_base[@]}" -c \
      "SELECT version FROM supabase_migrations.schema_migrations" 2>/dev/null)"; then
    :
  else
    db_reachable=0
    applied_versions=""
    echo "WARNING: could not read supabase_migrations.schema_migrations" >&2
    echo "         (database unreachable or table missing) —" >&2
    echo "         listing ALL migrations as would-apply." >&2
  fi
else
  "${psql_base[@]}" -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations" >/dev/null
  "${psql_base[@]}" -c "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      name text,
      statements text[]
    )" >/dev/null
  applied_versions="$("${psql_base[@]}" -c \
      "SELECT version FROM supabase_migrations.schema_migrations")"
fi

is_applied() { # $1 = version
  # No pipe here: `grep -q` exits on first match and closes the pipe, and under
  # pipefail the writer's EPIPE then fails the whole pipeline — intermittently
  # misreporting applied versions as pending (seen as duplicate-key aborts).
  grep -qx -- "$1" <<< "$applied_versions"
}

# ---------------------------------------------------------------------------
# Walk the files in order.
# ---------------------------------------------------------------------------
applied=0
skipped=0

for f in "${files[@]}"; do
  version="${f%%_*}"
  name="${f#"${version}"_}"; name="${name%.sql}"
  path="${migrations_dir}/${f}"

  if [ -n "$applied_versions" ] && is_applied "$version"; then
    if [ "$DRY_RUN" -eq 1 ]; then echo "skip:        $f"; fi
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would-apply: $f"
    applied=$((applied + 1))
    continue
  fi

  # Files with their own top-level BEGIN; manage their own transactions.
  txn_flag=(--single-transaction)
  if grep -Eqi '^[[:space:]]*BEGIN[[:space:]]*;' "$path"; then
    txn_flag=()
    echo "note: $f contains its own BEGIN/COMMIT — applying without --single-transaction"
    if ! grep -Eqi '^[[:space:]]*COMMIT[[:space:]]*;' "$path"; then
      echo "WARNING: $f has a top-level BEGIN; but no matching top-level COMMIT;" >&2
      echo "         — its final transaction may be left open/rolled back by psql." >&2
      echo "         Review the file before trusting this migration." >&2
    fi
  fi

  echo "applying:    $f"
  if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -qX "${txn_flag[@]}" -f "$path"; then
    echo "==================================================================" >&2
    echo "ERROR: migration FAILED: $f" >&2
    echo "Stopping. $applied migration(s) were applied before the failure;" >&2
    echo "the failed file was rolled back (or stopped at its own commit" >&2
    echo "boundary if it manages transactions itself) and was NOT recorded" >&2
    echo "in schema_migrations. Fix the issue and re-run." >&2
    echo "==================================================================" >&2
    exit 1
  fi

  # psql only interpolates :'var' from stdin/-f input, never inside -c.
  # ON CONFLICT: belt-and-braces against a concurrent applier (CI deploy-qa vs
  # a manual run) or a stale in-memory applied list — re-recording is a no-op.
  printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)\n        VALUES (:'v', :'n', '{}') ON CONFLICT (version) DO NOTHING;\n" \
    | "${psql_base[@]}" -v v="$version" -v n="$name" -f - >/dev/null
  applied=$((applied + 1))
done

echo "------------------------------------------------------------------"
if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$db_reachable" -eq 0 ]; then
    echo "DRY RUN (db unreachable): would apply $applied, skip $skipped, total $total"
  else
    echo "DRY RUN: would apply $applied, skip $skipped, total $total"
  fi
else
  echo "Done: applied $applied, skipped $skipped, total $total"
fi
