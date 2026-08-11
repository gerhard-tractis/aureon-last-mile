#!/usr/bin/env bash
# Local pgTAP harness for spec-52 (docker). NOT used by CI — CI runs only
# lint/type-check/test:run/build, so SQL must be verified here by hand.
#
#   ./scripts/pgtap-local.sh up              rebuild the container from scratch
#   ./scripts/pgtap-local.sh sync            copy migrations+tests into it
#   ./scripts/pgtap-local.sh apply           apply any not-yet-applied migrations
#   ./scripts/pgtap-local.sh run <test...>   run test files by basename
#   ./scripts/pgtap-local.sh psql            interactive shell
#   ./scripts/pgtap-local.sh down            remove the container
set -uo pipefail

C=spec52-pg
IMG=supabase/postgres:15.8.1.060
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="postgres/postgres"
export MSYS_NO_PATHCONV=1

dex()  { docker exec       "$C" "$@"; }
dexi() { docker exec -i    "$C" "$@"; }
psq()  { dex  psql -U postgres -d postgres "$@"; }
psqi() { dexi psql -U postgres -d postgres "$@"; }

# The stock supabase/postgres image differs from a real project database in
# three ways that break the repo's migrations and tests. Each shim below is a
# fidelity fix (matching production Supabase), not a workaround for our code.
bootstrap() {
  psqi -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgtap;

-- 1. The image ships the legacy auth.uid()/auth.role() that read only the
--    singular 'request.jwt.claim.sub' GUC. Production reads the 'claims' JSON
--    object too, and every test in this repo sets the JSON form.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

-- 2. auth.jwt() is absent from the image entirely; spec-45 RPCs and the
--    spec-47/52 pickup RPCs all call it.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim',  true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- 3. auth.users in the image is a stub; GoTrue normally adds these columns and
--    the repo's test fixtures insert into them.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone              text,
  ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS banned_until       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at         timestamptz,
  ADD COLUMN IF NOT EXISTS is_anonymous       boolean NOT NULL DEFAULT false;
SQL
}

case "${1:-}" in
  up)
    docker rm -f "$C" >/dev/null 2>&1
    docker run -d --name "$C" -e POSTGRES_PASSWORD=spec52 "$IMG" >/dev/null
    for i in $(seq 1 90); do
      psq -tAc "select 1" >/dev/null 2>&1 && sleep 3 && psq -tAc "select 1" >/dev/null 2>&1 && break
      sleep 2
    done
    "$0" sync
    bootstrap
    "$0" apply
    ;;
  sync)
    # Two traps here, both previously silent:
    #  1. docker cp on Windows/Git-Bash mangles an absolute "C:/..." SOURCE, and
    #     MSYS_NO_PATHCONV only protects the container side. Use a relative path.
    #  2. `docker cp src container:/supabase` copies INTO /supabase when that
    #     directory already exists, producing /supabase/supabase/... — so a
    #     second sync silently leaves stale files at the path everything reads.
    #     Always remove the destination first.
    dex rm -rf /supabase
    ( cd "$ROOT" && docker cp packages/database/supabase "$C:/supabase" >/dev/null ) \
      || { echo "sync FAILED" >&2; exit 1; }
    if dex test -d /supabase/supabase; then
      echo "sync FAILED: nested /supabase/supabase" >&2; exit 1
    fi
    dex test -d /supabase/migrations || { echo "sync FAILED: no migrations dir" >&2; exit 1; }
    echo "synced $(dex bash -c 'ls /supabase/migrations/*.sql | wc -l' | tr -d '\r') migrations, $(dex bash -c 'ls /supabase/tests/*.sql | wc -l' | tr -d '\r') tests into $C"
    ;;
  apply)
    # Ledger-based, mirroring the Supabase CLI and infra/supabase-qa/apply-migrations.sh.
    # Re-running every migration on each invocation is NOT idempotent: an early
    # migration recreates an object a later one dropped, and the database drifts
    # (observed: hub_receptions resurrected, 12 spurious failures). Apply each
    # version exactly once and record it.
    psq -q -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;
               CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
                 version text PRIMARY KEY, name text, statements text[]);" >/dev/null
    dex bash -c '
      applied=0; skipped=0; fail=0
      for f in $(ls /supabase/migrations/*.sql | sort); do
        base=$(basename "$f"); ver="${base%%_*}"
        n=$(psql -U postgres -d postgres -tAc "select count(*) from supabase_migrations.schema_migrations where version = '"'"'$ver'"'"'")
        if [ "$n" != "0" ]; then skipped=$((skipped+1)); continue; fi
        if psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/o.log 2>&1; then
          psql -U postgres -d postgres -q -c "insert into supabase_migrations.schema_migrations(version,name) values ('"'"'$ver'"'"','"'"'$base'"'"') on conflict do nothing"
          applied=$((applied+1))
        else
          fail=$((fail+1)); echo "FAIL $base"; grep -m1 "ERROR:" /tmp/o.log | sed "s/^/     /"
        fi
      done
      echo "migrations: applied=$applied skipped=$skipped failed=$fail"'
    ;;
  run)
    shift
    pass=0; fail=0
    for t in "$@"; do
      t="$(basename "$t" .sql)"
      printf "%-56s " "$t"
      out=$(psq -tA -f "/supabase/tests/$t.sql" 2>&1)
      if echo "$out" | grep -q "ERROR"; then
        fail=$((fail+1)); echo "FAIL"; echo "$out" | grep -m2 "ERROR" | sed 's/^/      /'
      else
        pass=$((pass+1)); echo "PASS"
      fi
    done
    echo "── pass=$pass fail=$fail ──"
    [ "$fail" -eq 0 ]
    ;;
  psql) shift; psq "$@" ;;
  down) docker rm -f "$C" >/dev/null 2>&1; echo "removed $C" ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
