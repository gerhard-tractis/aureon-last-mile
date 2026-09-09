#!/usr/bin/env bash
# Local pgTAP harness for spec-52 (docker). The 83 real test files under
# packages/database/supabase/tests are NOT run in CI — CI runs only
# lint/type-check/test:run/build, so those must be verified here by hand.
# (This wrapper's OWN correctness is a separate story: its self-test,
# scripts/pgtap-local.test.sh, does run in CI, against a throwaway
# container — see .github/workflows/ci.yml.)
#
#   ./scripts/pgtap-local.sh up              rebuild the container from scratch
#   ./scripts/pgtap-local.sh sync            copy migrations+tests into it
#   ./scripts/pgtap-local.sh apply           apply any not-yet-applied migrations
#   ./scripts/pgtap-local.sh run <test...>   run test files by basename
#   ./scripts/pgtap-local.sh psql            interactive shell
#   ./scripts/pgtap-local.sh down            remove the container
set -uo pipefail

# Overridable so CI (and this wrapper's own self-test) can point at a
# throwaway container instead of the shared local-dev spec52-pg.
C="${PGTAP_LOCAL_CONTAINER:-spec52-pg}"
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
      # M-2 fix: the repo mixes two real suffixes (*.test.sql and plain
      # *.sql — see `ls packages/database/supabase/tests`), and the old
      # code blindly looked for "$t.sql" with no existence check. A missing
      # file made `psql -f` print "psql: error: could not open file..." to
      # stderr (captured by 2>&1 below) in LOWERCASE, which the old
      # `grep -q "ERROR"` (uppercase) never matched — so a typo'd or
      # nonexistent test name silently reported PASS having run nothing.
      # Resolve the short name against both real suffixes inside the
      # container before running anything; neither existing is a loud FAIL.
      base="$(basename "$t" .sql)"
      base="${base%.test}"
      file=""
      for cand in "$base.test.sql" "$base.sql"; do
        if dex test -f "/supabase/tests/$cand"; then file="$cand"; break; fi
      done
      if [ -z "$file" ]; then
        printf "%-56s " "$base"
        fail=$((fail+1)); echo "FAIL (no such file: $base.test.sql / $base.sql)"
        continue
      fi
      printf "%-56s " "$file"
      out=$(psq -tA -f "/supabase/tests/$file" 2>&1)
      # Three real failure shapes. The first two are matched precisely (not a
      # bare case-insensitive "ERROR" — several tests RAISE NOTICE with the
      # lowercase word "error" inside a passing message, e.g. "raises no
      # error", "not an error"; a loose -i match turned those into false
      # FAILs):
      #   1. `psql:<file>:<line>: ERROR:  <msg>` — a RAISE EXCEPTION inside a
      #      DO block, this repo's house style for a failing assertion.
      #   2. `psql: error: could not open file...` — the file itself is
      #      missing/unreadable.
      #   3. Real pgTAP TAP output (`plan()`/`ok()`/`finish()`, ~12 of the 83
      #      test files use it): a failed assertion prints `not ok N` and
      #      psql's own exit code stays 0 — no ERROR: line, nothing the
      #      first two checks can see. Matched as `not ok [0-9]+($| )`, NOT
      #      `not ok [0-9]+ ` (a required trailing space) — a one/two-arg
      #      assertion (`ok(false)`, `is(a, b)` with no description) prints a
      #      bare `not ok N` with nothing after the number, and the
      #      space-anchored form missed it (round 2 review, A-1).
      #      A `1..N` plan whose executed `ok`+`not ok` line count doesn't
      #      match N — in EITHER direction, over or under — is also a
      #      failure: read straight off the `1..N` line itself, not off
      #      pgTAP's English "Looks like you..." diagnostic, because that
      #      diagnostic is only printed by `finish()` — a file that dies
      #      before `finish()` runs (no RAISE, e.g. someone deletes the
      #      `finish()` call, or a step upstream of it just returns early)
      #      leaves no diagnostic line at all and would otherwise pass
      #      silently (round 2 review, A-2/A-3).
      #
      # Round 3 review, three more edges in the same plan/TAP counting:
      #   - Sum EVERY `1..N` plan line, not just the first (`head -1`): a
      #     file with two independent plan()/finish() blocks (pgTAP allows
      #     this across separate transactions in one connection — a second
      #     plan() inside the SAME transaction as the first raises "You
      #     tried to plan twice!", caught by hard_error above, but a
      #     ROLLBACK between them resets pgTAP's session state and a second
      #     plan() is legal) restarts numbering at "1..1" each time; taking
      #     only the first plan against the file's TOTAL ok+not-ok count is
      #     a false mismatch (measured: two plan(1)+ok()+finish() blocks,
      #     both genuinely passing, reported FAIL pass=2 fail=1).
      #   - A `not ok` line carrying a `# TODO` directive is not a failure
      #     by TAP semantics (`ok N # SKIP` was already correctly excluded
      #     from failure — `# TODO` was not, an inverse blind spot).
      #   - Every FAIL branch below now prints the declared plan and the
      #     real ok/not-ok count unconditionally, not only when a `not ok`
      #     or pgTAP diagnostic line happens to exist to grep for — a bare
      #     "FAIL" with no explanation (the plan-mismatch-without-`not ok`
      #     case) costs more debugging time than the bug it catches.
      hard_error=""
      echo "$out" | grep -qE "ERROR:|^psql: error:" && hard_error=1
      ok_n=$(echo "$out" | grep -cE '^ok [0-9]+($| )')
      notok_n=$(echo "$out" | grep -cE '^not ok [0-9]+($| )')
      notok_todo_n=$(echo "$out" | grep -ciE '^not ok [0-9]+.*# *TODO\b')
      notok_real_n=$((notok_n - notok_todo_n))
      ran_n=$((ok_n + notok_n))
      plan_calls=$(echo "$out" | grep -cE '^[0-9]+\.\.[0-9]+$')
      plan_total=0
      while IFS= read -r n; do
        [ -n "$n" ] && plan_total=$((plan_total + n))
      done < <(echo "$out" | grep -oE '^[0-9]+\.\.[0-9]+$' | sed -E 's/^[0-9]+\.\.//')
      mismatch_n=0
      if [ "$plan_calls" -gt 0 ] && [ "$plan_total" -ne "$ran_n" ]; then
        if [ "$plan_total" -gt "$ran_n" ]; then mismatch_n=$((plan_total - ran_n))
        else mismatch_n=$((ran_n - plan_total)); fi
      fi
      if [ -n "$hard_error" ]; then
        # Transaction aborted — partial TAP counts inside it aren't
        # trustworthy, so count the file as one failure, matching the
        # non-TAP (RAISE EXCEPTION style) files' granularity.
        fail=$((fail+1)); echo "FAIL"; echo "$out" | grep -E "ERROR:|^psql: error:" | head -2 | sed 's/^/      /'
      elif [ "$notok_real_n" -gt 0 ] || [ "$mismatch_n" -gt 0 ]; then
        fail=$((fail + notok_real_n + mismatch_n))
        pass=$((pass + ok_n + notok_todo_n))
        echo "FAIL"
        echo "$out" | grep -E '^not ok [0-9]+($| )|^# Looks like you' | head -3 | sed 's/^/      /'
        echo "      plan: $plan_calls plan() call(s) declaring $plan_total total; ran ok=$ok_n not_ok=$notok_n (todo=$notok_todo_n) = $ran_n"
      elif [ "$ok_n" -gt 0 ] || [ "$notok_todo_n" -gt 0 ]; then
        # Real TAP output, every assertion passed (or was an accepted TODO
        # failure) — count assertions, not the file, so the summary
        # reflects real asserts run.
        pass=$((pass + ok_n + notok_todo_n)); echo "PASS"
      else
        # No TAP output at all (RAISE EXCEPTION style file) and no error —
        # per-file is the only granularity available.
        pass=$((pass+1)); echo "PASS"
      fi
    done
    echo "── pass=$pass fail=$fail ──"
    [ "$fail" -eq 0 ]
    ;;
  # -i (dexi/psqi), not dex/psq: docker exec without -i silently drops stdin,
  # so piping a query in (`echo "select 1" | pgtap-local.sh psql -tA`) prints
  # nothing and exits 0 — a false negative of the exact shape this file
  # exists to catch (round 2 review, A-8).
  psql) shift; psqi "$@" ;;
  down) docker rm -f "$C" >/dev/null 2>&1; echo "removed $C" ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
