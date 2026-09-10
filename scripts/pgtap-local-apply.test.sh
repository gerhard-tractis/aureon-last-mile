#!/usr/bin/env bash
# Self-test for scripts/pgtap-local.sh's `apply` subcommand — specifically
# the content-hash guard added because `apply` used to skip a migration
# purely on its VERSION being present in the ledger, never looking at the
# file's content. A mutant applied to an already-applied version was
# silently skipped: the mutant never reached the database, and any pgTAP
# test run afterward "passed" against the unmutated original. Reproduced by
# two independent agents on 2026-09-10.
#
# This proves, against the LIVE DATABASE OBJECT (not the command's exit
# code or a grep of its output — that is the whole lesson here):
#   1. a first apply lands the original function,
#   2. mutating the file under the SAME version and re-running apply
#      WARNS and does NOT change the live function,
#   3. `apply --force <version>` DOES change it,
#   4. `apply --force <bogus-version>` fails loudly instead of doing nothing.
#
# Requires a container named $C reachable via `docker exec ... psql`, with
# the pgtap extension installed — nothing else. Never spec52-pg: this test
# writes into /supabase/migrations and the schema_migrations ledger, which
# on the shared local-dev container is live, real migration history other
# worktrees depend on. Use your own throwaway container (matching CI's
# pattern in .github/workflows/ci.yml).
#
# Run from repo root:
#   PGTAP_LOCAL_CONTAINER=<your-own-container> bash scripts/pgtap-local-apply.test.sh
set -uo pipefail

export PGTAP_LOCAL_CONTAINER="${PGTAP_LOCAL_CONTAINER:?set PGTAP_LOCAL_CONTAINER to your OWN throwaway container — never spec52-pg}"
C="$PGTAP_LOCAL_CONTAINER"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="${APPLY_TEST_WRAPPER:-$ROOT/scripts/pgtap-local.sh}"
FIXDIR="$ROOT/scripts/pgtap-local-fixtures"
export MSYS_NO_PATHCONV=1
VER="99999999999901"
FUNC="public.pgtap_apply_selftest_widget"
MIGFILE="${VER}_pgtap_apply_selftest.sql"

docker exec "$C" psql -U postgres -d postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "SKIP: container '$C' not reachable" >&2
  exit 1
}
docker exec "$C" mkdir -p /supabase/migrations /supabase/tests

cleanup() {
  docker exec "$C" rm -f "/supabase/migrations/$MIGFILE" >/dev/null 2>&1
  docker exec "$C" psql -U postgres -d postgres -q -c \
    "delete from supabase_migrations.schema_migrations where version = '$VER'; drop function if exists $FUNC();" >/dev/null 2>&1
}
trap cleanup EXIT

fails=0
ok() { echo "ok - $1"; }
notok() { echo "not ok - $1"; fails=$((fails+1)); }

live_value() {
  docker exec "$C" psql -U postgres -d postgres -tAc "select $FUNC()" 2>/dev/null | tr -d ' \r'
}

cleanup  # start from a clean slate in case a previous run was interrupted

# --- step 1: first apply lands the original (42) ---
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_v1.sql" "$C:/supabase/migrations/$MIGFILE" >/dev/null ) \
  || { echo "not ok - fixture v1 failed to copy into $C"; exit 1; }
out1=$(bash "$WRAPPER" apply 2>&1)
v1=$(live_value)
if [ "$v1" = "42" ]; then ok "first apply lands the original function (returns 42)"
else notok "first apply lands the original function (got '$v1', output: $out1)"; fi

# --- step 2: mutate under the SAME version, re-apply without --force ---
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_v2_mutant.sql" "$C:/supabase/migrations/$MIGFILE" >/dev/null ) \
  || { echo "not ok - fixture v2 (mutant) failed to copy into $C"; exit 1; }
out2=$(bash "$WRAPPER" apply 2>&1)
v2=$(live_value)
if printf '%s\n' "$out2" | grep -qF "changed since it was applied"; then
  ok "a mutated file under an already-applied version prints a loud WARNING"
else
  notok "a mutated file under an already-applied version prints a loud WARNING (output: $out2)"
fi
if printf '%s\n' "$out2" | grep -qE 'changed=[1-9]'; then
  ok "the summary line counts it under changed=, not silently under skipped="
else
  notok "the summary line counts it under changed= (output: $out2)"
fi
if [ "$v2" = "42" ]; then
  ok "the mutant is NOT applied without --force (live function still returns 42)"
else
  notok "the mutant is NOT applied without --force (live function returned '$v2' — THE BUG THIS TEST EXISTS TO CATCH)"
fi

# --- step 3: --force pushes the mutant through ---
out3=$(bash "$WRAPPER" apply --force "$VER" 2>&1); rc3=$?
v3=$(live_value)
if [ "$rc3" -eq 0 ] && [ "$v3" = "999" ]; then
  ok "'apply --force <version>' applies the mutant (live function now returns 999)"
else
  notok "'apply --force <version>' applies the mutant (rc=$rc3, live='$v3', output: $out3)"
fi

# --- step 4: --force with a bogus version fails loudly, doesn't swallow ---
out4=$(bash "$WRAPPER" apply --force "00000000000000" 2>&1); rc4=$?
if [ "$rc4" -ne 0 ] && printf '%s\n' "$out4" | grep -qF "matches no file"; then
  ok "'apply --force <bogus-version>' fails loudly instead of doing nothing silently"
else
  notok "'apply --force <bogus-version>' fails loudly (rc=$rc4, output: $out4)"
fi

if [ "$fails" -eq 0 ]; then
  echo "── pgtap-local-apply.test.sh: PASS ──"
  exit 0
else
  echo "── pgtap-local-apply.test.sh: FAIL ($fails) ──"
  exit 1
fi
