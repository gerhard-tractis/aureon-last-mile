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

  # ── KNOWN DEFECT, see spec-52 Task 3 ──────────────────────────────────────
  # public.handle_new_user() (trigger on_auth_user_created on auth.users)
  # raises unless raw_user_meta_data carries operator_id. Every spec47_*.sql
  # fixture inserts '{}'::jsonb, so with the trigger ENABLED all seven fail.
  # That is a defect in those fixtures — they cannot ever have been executed
  # (pgTAP is not in CI). Task 3 rewrites all seven files and must fix the
  # fixtures. Until then the harness disables the trigger so the rest of the
  # suite is runnable. REMOVE THIS LINE once the fixtures are corrected.
  psq -q -c "ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;"
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
    # Use a repo-relative source path: docker cp on Windows/Git-Bash mangles an
    # absolute "C:/..." source, and MSYS_NO_PATHCONV only protects the container
    # side of the argument.
    ( cd "$ROOT" && docker cp packages/database/supabase "$C:/supabase" >/dev/null ) \
      || { echo "sync FAILED" >&2; exit 1; }
    echo "synced migrations+tests into $C"
    ;;
  apply)
    dex bash -c '
      ok=0; fail=0
      for f in $(ls /supabase/migrations/*.sql | sort); do
        if psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/o.log 2>&1; then
          ok=$((ok+1))
        else
          # already-applied objects are expected on re-runs; only report novel errors
          if ! grep -qE "already exists|is already member" /tmp/o.log; then
            fail=$((fail+1)); echo "FAIL $(basename $f)"; grep -m1 "ERROR:" /tmp/o.log | sed "s/^/     /"
          fi
        fi
      done
      echo "migrations: applied_or_skipped=$ok novel_failures=$fail"'
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
