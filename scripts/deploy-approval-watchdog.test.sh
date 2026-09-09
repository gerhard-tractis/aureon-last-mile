#!/usr/bin/env bash
#
# Tests for deploy-approval-watchdog.mjs (spec-92 fase 3) — the decision
# half of the parked-deploy watchdog. Pure: state in as JSON, one decision
# out, same shape as qa-drift-check.mjs (spec-57/61).
#
# Run: bash scripts/deploy-approval-watchdog.test.sh
set -uo pipefail

SCRIPT="$(dirname "$0")/deploy-approval-watchdog.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

NOW='2026-09-09T15:00:00Z'

# assert_action <expected action> <test name> <json>
assert_action() {
  local expected="$1" name="$2" json="$3" output actual
  printf '%s\n' "$json" > "$TMP/state.json"
  output=$(node "$SCRIPT" "$TMP/state.json" 2>&1)
  actual=$(printf '%s' "$output" | grep '^action=' | cut -d= -f2)
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected action=$expected, got action=$actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

# assert_exit_code <expected code> <test name> <json>
assert_exit_code() {
  local expected="$1" name="$2" json="$3" actual
  printf '%s\n' "$json" > "$TMP/state.json"
  node "$SCRIPT" "$TMP/state.json" > /dev/null 2>&1
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected exit $expected, got $actual"
  fi
}

# assert_output <needle> <test name> <json>
assert_output() {
  local needle="$1" name="$2" json="$3" output
  printf '%s\n' "$json" > "$TMP/state.json"
  output=$(node "$SCRIPT" "$TMP/state.json" 2>&1)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "deploy-approval-watchdog.mjs"

# ── The run for main's tip already deployed — stay silent ────────────────────
assert_action ok "ok when main's tip deployed successfully" '{
  "now": "'"$NOW"'", "mainSha": "aaa1111", "mainCommittedAt": "2026-09-09T14:00:00Z",
  "graceMinutes": 60,
  "runs": [{"databaseId": 1, "headSha": "aaa1111", "status": "completed", "conclusion": "success", "createdAt": "2026-09-09T14:01:00Z"}]
}'

# ── No run yet, but still inside the grace window ─────────────────────────────
assert_action in_flight "in_flight when no run exists but merge is recent" '{
  "now": "2026-09-09T14:10:00Z", "mainSha": "bbb2222", "mainCommittedAt": "2026-09-09T14:00:00Z",
  "graceMinutes": 60,
  "runs": []
}'

# ── A run exists, still running, inside the grace window ─────────────────────
assert_action in_flight "in_flight when the run is still in progress, inside grace" '{
  "now": "2026-09-09T14:10:00Z", "mainSha": "ccc3333", "mainCommittedAt": "2026-09-09T14:00:00Z",
  "graceMinutes": 60,
  "runs": [{"databaseId": 2, "headSha": "ccc3333", "status": "in_progress", "conclusion": null, "createdAt": "2026-09-09T14:01:00Z"}]
}'

# ── No run at all, past the grace window ──────────────────────────────────────
assert_action alert "alert when no run exists for main's tip after the grace window" '{
  "now": "'"$NOW"'", "mainSha": "ddd4444", "mainCommittedAt": "2026-09-09T13:00:00Z",
  "graceMinutes": 60,
  "runs": []
}'
assert_output "no deploy run exists" "names the missing-run reason" '{
  "now": "'"$NOW"'", "mainSha": "ddd4444", "mainCommittedAt": "2026-09-09T13:00:00Z",
  "graceMinutes": 60,
  "runs": []
}'

# ── The run is still not completed, past the grace window — parked ───────────
assert_action alert "alert when the run is still unresolved past grace" '{
  "now": "'"$NOW"'", "mainSha": "eee5555", "mainCommittedAt": "2026-09-09T13:00:00Z",
  "graceMinutes": 60,
  "runs": [{"databaseId": 3, "headSha": "eee5555", "status": "waiting", "conclusion": null, "createdAt": "2026-09-09T13:01:00Z"}]
}'
assert_output "run 3" "names the run number" '{
  "now": "'"$NOW"'", "mainSha": "eee5555", "mainCommittedAt": "2026-09-09T13:00:00Z",
  "graceMinutes": 60,
  "runs": [{"databaseId": 3, "headSha": "eee5555", "status": "waiting", "conclusion": null, "createdAt": "2026-09-09T13:01:00Z"}]
}'

# ── The run completed but failed (E2E red, freshness check, etc.), past grace ─
assert_action alert "alert when the run completed but failed, past grace" '{
  "now": "'"$NOW"'", "mainSha": "fff6666", "mainCommittedAt": "2026-09-09T13:00:00Z",
  "graceMinutes": 60,
  "runs": [{"databaseId": 4, "headSha": "fff6666", "status": "completed", "conclusion": "failure", "createdAt": "2026-09-09T13:01:00Z"}]
}'

# ── Two unresolved runs at once, for DIFFERENT commits — alert even though
# both are inside the 60-minute grace window. This is the race spec-57 never
# closed: approving/letting the older one through after a newer merge landed
# deploys stale code, and waiting an hour to say so is too late to matter.
assert_action alert "alert when two runs are unresolved simultaneously, even inside grace" '{
  "now": "2026-09-09T14:05:00Z", "mainSha": "hhh8888", "mainCommittedAt": "2026-09-09T14:00:00Z",
  "graceMinutes": 60,
  "runs": [
    {"databaseId": 5, "headSha": "ggg7777", "status": "waiting", "conclusion": null, "createdAt": "2026-09-09T13:50:00Z"},
    {"databaseId": 6, "headSha": "hhh8888", "status": "waiting", "conclusion": null, "createdAt": "2026-09-09T14:01:00Z"}
  ]
}'
assert_output "cancel" "recommends cancelling the older run" '{
  "now": "2026-09-09T14:05:00Z", "mainSha": "hhh8888", "mainCommittedAt": "2026-09-09T14:00:00Z",
  "graceMinutes": 60,
  "runs": [
    {"databaseId": 5, "headSha": "ggg7777", "status": "waiting", "conclusion": null, "createdAt": "2026-09-09T13:50:00Z"},
    {"databaseId": 6, "headSha": "hhh8888", "status": "waiting", "conclusion": null, "createdAt": "2026-09-09T14:01:00Z"}
  ]
}'

# ── B2 (review 2026-09-09, PR #716) — stale failed/cancelled runs from days
# ago must not count as "unresolved" forever. Reproduces the measured bug
# exactly: no run yet for main's recent tip (nothing wrong — it just merged),
# but 3 old cancelled/failed runs from ~36h ago are still in the last-20-runs
# window. Verified against the pre-fix decide(): it returned
# action=alert ("3 runs are unresolved for different commits at once")
# because `distinctUnresolvedShas.size > 1` counted them regardless of age —
# permanently, since a completed-but-failed run never left the list.
assert_action in_flight "old cancelled/failed runs (36h) do not count as live-unresolved" '{
  "now": "2026-09-09T15:00:00Z", "mainSha": "jjj0000", "mainCommittedAt": "2026-09-09T14:55:00Z",
  "graceMinutes": 60,
  "runs": [
    {"databaseId": 7, "headSha": "old-a", "status": "completed", "conclusion": "cancelled", "createdAt": "2026-09-08T03:00:00Z"},
    {"databaseId": 8, "headSha": "old-b", "status": "completed", "conclusion": "failure", "createdAt": "2026-09-08T05:00:00Z"},
    {"databaseId": 9, "headSha": "old-c", "status": "completed", "conclusion": "cancelled", "createdAt": "2026-09-08T09:00:00Z"}
  ]
}'

# ── M4 (review 2026-09-09, PR #716) — a run for an OLDER commit that failed
# RECENTLY (still within grace) must not be hidden just because a NEWER
# commit's run succeeded. This is the 2026-08-17→22 incident shape: A fails,
# B (unrelated, later) merges and goes green. Verified against the pre-fix
# decide(): it checked `run && isResolved(run)` FIRST and returned
# action=ok unconditionally, closing the issue with A's failure unaddressed.
assert_action alert "a recent failed run for an older commit is not hidden by a newer success" '{
  "now": "2026-09-09T14:20:00Z", "mainSha": "kkk1111", "mainCommittedAt": "2026-09-09T14:15:00Z",
  "graceMinutes": 60,
  "runs": [
    {"databaseId": 12, "headSha": "kkk1111", "status": "completed", "conclusion": "success", "createdAt": "2026-09-09T14:16:00Z"},
    {"databaseId": 11, "headSha": "old-failed", "status": "completed", "conclusion": "failure", "createdAt": "2026-09-09T14:00:00Z"}
  ]
}'
assert_output "run(s) 11" "names the unaddressed older failed run" '{
  "now": "2026-09-09T14:20:00Z", "mainSha": "kkk1111", "mainCommittedAt": "2026-09-09T14:15:00Z",
  "graceMinutes": 60,
  "runs": [
    {"databaseId": 12, "headSha": "kkk1111", "status": "completed", "conclusion": "success", "createdAt": "2026-09-09T14:16:00Z"},
    {"databaseId": 11, "headSha": "old-failed", "status": "completed", "conclusion": "failure", "createdAt": "2026-09-09T14:00:00Z"}
  ]
}'

# ── M3 (review 2026-09-09, PR #716) — an unprotected production gate alerts
# even when the deploy itself looks perfectly clean. Nothing else in this
# repo watches whether the `production` environment still has its
# required-reviewer rule; it is live GitHub config, invisible to any YAML
# guard.
assert_action alert "productionGateProtected: false overrides an otherwise-clean ok" '{
  "now": "'"$NOW"'", "mainSha": "lll2222", "mainCommittedAt": "2026-09-09T14:59:00Z",
  "graceMinutes": 60, "productionGateProtected": false,
  "runs": [{"databaseId": 13, "headSha": "lll2222", "status": "completed", "conclusion": "success", "createdAt": "2026-09-09T14:59:30Z"}]
}'
assert_output "required-reviewer rule" "names the lost protection" '{
  "now": "'"$NOW"'", "mainSha": "lll2222", "mainCommittedAt": "2026-09-09T14:59:00Z",
  "graceMinutes": 60, "productionGateProtected": false,
  "runs": [{"databaseId": 13, "headSha": "lll2222", "status": "completed", "conclusion": "success", "createdAt": "2026-09-09T14:59:30Z"}]
}'
assert_action ok "productionGateProtected: true does not change prior behaviour" '{
  "now": "'"$NOW"'", "mainSha": "mmm3333", "mainCommittedAt": "2026-09-09T14:59:00Z",
  "graceMinutes": 60, "productionGateProtected": true,
  "runs": [{"databaseId": 14, "headSha": "mmm3333", "status": "completed", "conclusion": "success", "createdAt": "2026-09-09T14:59:30Z"}]
}'

# ── Fail closed: incomplete/invalid state must never resolve to ok/alert ─────
assert_exit_code 2 "missing mainSha refuses to guess" '{
  "now": "'"$NOW"'", "mainCommittedAt": "2026-09-09T13:00:00Z", "runs": []
}'
assert_exit_code 2 "runs is not an array refuses to guess" '{
  "now": "'"$NOW"'", "mainSha": "iii9999", "mainCommittedAt": "2026-09-09T13:00:00Z", "runs": "not-an-array"
}'
assert_exit_code 2 "invalid JSON refuses to guess" 'not valid json at all'
rm -f "$TMP/nonexistent.json"
output=$(node "$SCRIPT" "$TMP/nonexistent.json" 2>&1); actual=$?
if [ "$actual" -eq 2 ]; then
  pass=$((pass + 1)); echo "  ok   nonexistent state file exits 2"
else
  fail=$((fail + 1)); echo "  FAIL nonexistent state file — expected exit 2, got $actual"
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
