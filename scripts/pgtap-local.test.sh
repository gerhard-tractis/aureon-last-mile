#!/usr/bin/env bash
# Self-test for scripts/pgtap-local.sh's `run` subcommand.
#
# This is the guardrail's own guardrail: `run` decides PASS/FAIL from psql
# output, and a pgTAP failed assertion ("not ok") never sets psql's exit
# code and never prints "ERROR:" — a bare `grep -q ERROR:` (or a bare exit
# code check) reports PASS on a file that actually failed. This test proves
# `run` does not have that hole, using its own fixture files, not the 84
# real product test files under packages/database/supabase/tests.
#
# Requires the shared spec52-pg container already up (scripts/pgtap-local.sh up)
# and synced. Run from repo root:
#   bash scripts/pgtap-local.test.sh
set -uo pipefail

C=spec52-pg
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="$ROOT/scripts/pgtap-local.sh"
FIXDIR="$ROOT/scripts/pgtap-local-fixtures"
export MSYS_NO_PATHCONV=1

docker exec "$C" test -d /supabase/tests 2>/dev/null || {
  echo "SKIP: $C has no /supabase/tests — run 'scripts/pgtap-local.sh up' first" >&2
  exit 1
}

cleanup() {
  docker exec "$C" rm -f /supabase/tests/tap_pass.test.sql /supabase/tests/tap_fail.test.sql >/dev/null 2>&1
}
trap cleanup EXIT

fails=0

expect_exit() {
  local name="$1" want="$2" got="$3"
  if [ "$got" -eq "$want" ]; then
    echo "ok - $name (exit=$got)"
  else
    echo "not ok - $name (expected exit $want, got $got)"
    fails=$((fails+1))
  fi
}

# docker cp mangles an absolute "C:/..." SOURCE path on Windows/Git-Bash even
# with MSYS_NO_PATHCONV=1 (that only protects the container-side path) — see
# the same trap documented in pgtap-local.sh's `sync`. Use relative sources.
( cd "$ROOT" && docker cp scripts/pgtap-local-fixtures/tap_pass.test.sql "$C:/supabase/tests/tap_pass.test.sql" >/dev/null )
( cd "$ROOT" && docker cp scripts/pgtap-local-fixtures/tap_fail.test.sql "$C:/supabase/tests/tap_fail.test.sql" >/dev/null )

out_pass=$(bash "$WRAPPER" run tap_pass 2>&1); rc_pass=$?
echo "$out_pass" | sed 's/^/      [tap_pass output] /'
expect_exit "a passing pgTAP file makes run exit 0" 0 "$rc_pass"

out_fail=$(bash "$WRAPPER" run tap_fail 2>&1); rc_fail=$?
echo "$out_fail" | sed 's/^/      [tap_fail output] /'
if [ "$rc_fail" -eq 0 ]; then
  echo "not ok - a failing pgTAP file ('not ok') makes run exit nonzero (expected nonzero, got 0)"
  fails=$((fails+1))
else
  echo "ok - a failing pgTAP file ('not ok') makes run exit nonzero (exit=$rc_fail)"
fi

if [ "$fails" -eq 0 ]; then
  echo "── pgtap-local.test.sh: PASS ──"
  exit 0
else
  echo "── pgtap-local.test.sh: FAIL ($fails) ──"
  exit 1
fi
