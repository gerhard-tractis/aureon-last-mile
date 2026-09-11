#!/usr/bin/env bash
# Self-test for scripts/pgtap-local.sh's `run` subcommand.
#
# This is the guardrail's own guardrail: `run` decides PASS/FAIL from psql
# output, and a pgTAP failed assertion ("not ok") never sets psql's exit
# code and never prints "ERROR:" — a bare `grep -q ERROR:` (or a bare exit
# code check) reports PASS on a file that actually failed. This test proves
# `run` does not have that hole, using its own fixture files under
# scripts/pgtap-local-fixtures/, never the 83 real product test files under
# packages/database/supabase/tests.
#
# Round 2 review (A-4): every assertion below checks the ACTUAL OUTPUT
# content, not just the exit code — a fixture that silently failed to land
# in the container (docker cp raced with another session's `sync` on the
# shared spec52-pg, or the container never had it) makes `run` report
# "FAIL (no such file...)" with a nonzero exit code too, and an rc-only
# check would call that a pass for the wrong reason. This is not
# theoretical: it happened to a reviewer testing this exact PR.
#
# Requires a container named $C reachable via `docker exec ... psql`,
# with the pgtap extension installed (CREATE EXTENSION pgtap;) — nothing
# else. No migrations required. Locally that's the shared spec52-pg
# (scripts/pgtap-local.sh up); in CI it's a throwaway container brought up
# by the workflow step, never spec52-pg (round 2 review, A-6). Same
# PGTAP_LOCAL_CONTAINER env var the wrapper itself reads, exported below so
# `run` (invoked as a subprocess) points at the same container this script
# just populated with fixtures — a wrapper still hardcoded to spec52-pg
# would look for these fixtures in the wrong (or nonexistent) container.
#
# Run from repo root:
#   bash scripts/pgtap-local.test.sh
set -uo pipefail

export PGTAP_LOCAL_CONTAINER="${PGTAP_LOCAL_CONTAINER:-spec52-pg}"
C="$PGTAP_LOCAL_CONTAINER"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="$ROOT/scripts/pgtap-local.sh"
FIXDIR="$ROOT/scripts/pgtap-local-fixtures"
export MSYS_NO_PATHCONV=1

docker exec "$C" psql -U postgres -d postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "SKIP: container '$C' not reachable — bring one up first (scripts/pgtap-local.sh up, or PGTAP_LOCAL_CONTAINER=<name>)" >&2
  exit 1
}
docker exec "$C" mkdir -p /supabase/tests

FIXTURES="tap_pass tap_fail tap_fail_no_desc plan_overshoot plan_undershoot_no_finish err_raise r3_twoplans r3_todo r3_notok_count"
cleanup() {
  for f in $FIXTURES; do
    docker exec "$C" rm -f "/supabase/tests/$f.test.sql" >/dev/null 2>&1
  done
}
trap cleanup EXIT

fails=0
check() {
  # $1 = description, $2 = 0|nonzero, $3 = actual rc, $4 = full output,
  # $5 = a fixed string that MUST appear in the output (the real evidence).
  local desc="$1" want="$2" rc="$3" out="$4" needle="$5"
  local rc_ok=0
  if [ "$want" = "0" ]; then [ "$rc" -eq 0 ] || rc_ok=1
  else [ "$rc" -ne 0 ] || rc_ok=1
  fi
  local needle_ok=0
  printf '%s\n' "$out" | grep -qF -- "$needle" || needle_ok=1
  if [ "$rc_ok" -eq 0 ] && [ "$needle_ok" -eq 0 ]; then
    echo "ok - $desc"
  else
    echo "not ok - $desc (rc=$rc, wanted 0=$want; needle_ok=$([ "$needle_ok" -eq 0 ] && echo yes || echo no): '$needle')"
    printf '%s\n' "$out" | sed 's/^/      [output] /'
    fails=$((fails+1))
  fi
}

for f in $FIXTURES; do
  # docker cp mangles an absolute "C:/..." SOURCE path on Windows/Git-Bash
  # even with MSYS_NO_PATHCONV=1 (that only protects the container-side
  # path) — same trap documented in pgtap-local.sh's `sync`. Relative source.
  ( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/$f.test.sql" "$C:/supabase/tests/$f.test.sql" >/dev/null ) \
    || { echo "not ok - fixture $f.test.sql failed to copy into $C"; fails=$((fails+1)); continue; }
  docker exec "$C" test -f "/supabase/tests/$f.test.sql" \
    || { echo "not ok - fixture $f.test.sql did not land in $C:/supabase/tests (raced with another sync?)"; fails=$((fails+1)); }
done

out_pass=$(bash "$WRAPPER" run tap_pass 2>&1); rc_pass=$?
check "a passing pgTAP file (with description) makes run exit 0" 0 "$rc_pass" "$out_pass" \
  "── pass=1 fail=0 ──"

out_fail=$(bash "$WRAPPER" run tap_fail 2>&1); rc_fail=$?
check "a failing pgTAP assertion ('not ok N - desc') makes run exit nonzero" nonzero "$rc_fail" "$out_fail" \
  "not ok 1 - trivially false"

# A-1: a one/two-arg assertion (ok(false), no description) prints a bare
# "not ok N" with no trailing space — the exact shape a space-anchored
# regex misses.
out_nodesc=$(bash "$WRAPPER" run tap_fail_no_desc 2>&1); rc_nodesc=$?
check "a failing pgTAP assertion with NO description ('not ok N') is still caught" nonzero "$rc_nodesc" "$out_nodesc" \
  "not ok 1"
if printf '%s\n' "$out_nodesc" | grep -qE '^tap_fail_no_desc\.test\.sql +PASS$'; then
  echo "not ok - tap_fail_no_desc was reported PASS"
  fails=$((fails+1))
fi

# A-2: more assertions run than plan() declared — a real TAP failure in the
# opposite direction from a shortfall.
out_over=$(bash "$WRAPPER" run plan_overshoot 2>&1); rc_over=$?
check "a plan() overshoot (ran > planned) makes run exit nonzero" nonzero "$rc_over" "$out_over" \
  "Looks like you planned 1 test but ran 2"

# A-3: plan() undershoot with finish() never called at all — no "Looks
# like you..." diagnostic exists to grep for.
out_noplan=$(bash "$WRAPPER" run plan_undershoot_no_finish 2>&1); rc_noplan=$?
check "a plan() shortfall with finish() never called still makes run exit nonzero" nonzero "$rc_noplan" "$out_noplan" \
  "── pass=1 fail=4 ──"
# Round 3, item 1: a plan mismatch with no 'not ok' or pgTAP diagnostic to
# grep for used to print a bare "FAIL" and nothing else — the declared plan
# and real count must be printed unconditionally.
check "  ...and prints WHY (declared plan vs. real count), not a bare FAIL" nonzero "$rc_noplan" "$out_noplan" \
  "plan: 1 plan() call(s) declaring 5 total; ran ok=1 not_ok=0 (todo=0) = 1"

# Round 3, item 2: two independent plan()/finish() blocks in one file (legal
# pgTAP — a ROLLBACK between them resets session state) both pass. Taking
# only the FIRST "1..N" plan (head -1) against the file's total ok count is
# a false mismatch — kills the head -1 -> tail -1 mutant.
out_twoplans=$(bash "$WRAPPER" run r3_twoplans 2>&1); rc_twoplans=$?
check "two independent plan()/finish() blocks, both passing, make run exit 0" 0 "$rc_twoplans" "$out_twoplans" \
  "── pass=2 fail=0 ──"

# Round 3, item 3: a 'not ok' carrying a '# TODO' directive is not a
# failure by TAP semantics (ok N # SKIP was already correctly excluded;
# # TODO was not — an inverse blind spot).
out_todo=$(bash "$WRAPPER" run r3_todo 2>&1); rc_todo=$?
check "a 'not ok ... # TODO' assertion is not counted as a failure" 0 "$rc_todo" "$out_todo" \
  "── pass=2 fail=0 ──"

# Round 3 mutant coverage: plan(3) with three REAL failures and zero passes.
# Kills the `ran_n=$((ok_n + notok_n))` -> `ran_n=$((ok_n))` mutant — without
# not-ok counted into ran_n, this file's plan (3) looks like it "ran" 0,
# double-counting the three real failures as a plan mismatch too (fail=6
# instead of the correct fail=3).
out_notokcount=$(bash "$WRAPPER" run r3_notok_count 2>&1); rc_notokcount=$?
check "three real pgTAP failures against plan(3) are counted once, not doubled" nonzero "$rc_notokcount" "$out_notokcount" \
  "── pass=0 fail=3 ──"

# A-5: the pre-existing ERROR: detection (non-pgTAP, RAISE EXCEPTION style
# — most of the 83 real test files) must still work after this rewrite.
out_raise=$(bash "$WRAPPER" run err_raise 2>&1); rc_raise=$?
check "a plain RAISE EXCEPTION (no pgTAP) still makes run exit nonzero" nonzero "$rc_raise" "$out_raise" \
  "fixture: this assertion always fails"

# A-4/A-5: a nonexistent test name is a loud failure, not a silent pass —
# and NOT the same failure as a real TAP 'not ok' (different needle).
out_missing=$(bash "$WRAPPER" run this_file_does_not_exist_zzz 2>&1); rc_missing=$?
check "a nonexistent test name makes run exit nonzero, reported as missing" nonzero "$rc_missing" "$out_missing" \
  "no such file: this_file_does_not_exist_zzz"

if [ "$fails" -eq 0 ]; then
  echo "── pgtap-local.test.sh: PASS ──"
  exit 0
else
  echo "── pgtap-local.test.sh: FAIL ($fails) ──"
  exit 1
fi
