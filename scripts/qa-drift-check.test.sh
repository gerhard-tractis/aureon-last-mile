#!/usr/bin/env bash
#
# Tests for qa-drift-check.mjs — the decision half of the QA drift watchdog.
# Run: bash scripts/qa-drift-check.test.sh
#
# The script is pure: state in as JSON, one decision out. Everything that talks
# to GitHub or the VPS lives in the workflow, so every branch below is testable
# without either.
#
set -uo pipefail

SCRIPT="$(dirname "$0")/qa-drift-check.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

NOW='2026-08-17T15:00:00Z'

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

echo "qa-drift-check.mjs"

# ── QA is current — the common case, and it must stay silent ─────────────────
assert_action ok "ok when QA is on main's tip" '{
  "now": "'"$NOW"'",
  "qaSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T14:56:43Z",
  "graceMinutes": 20,
  "runs": []
}'

# ── A deploy that has not had time to run yet is not drift ───────────────────
assert_action in_flight "quiet while the commit is still inside the grace window" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T14:56:43Z",
  "graceMinutes": 20,
  "runs": []
}'

# ── Drifted, and the run for that SHA failed → heal it ───────────────────────
FAILED_RUN='{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T14:20:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "completed", "conclusion": "failure", "attempt": 1}
  ]
}'
assert_action rerun "re-runs a failed deploy for main's tip" "$FAILED_RUN"
assert_output "run_id=32041150063" "reports which run to re-run" "$FAILED_RUN"
assert_output "rerun_mode=failed" "re-runs only the failed jobs of a failed run" "$FAILED_RUN"

# ── Already re-run once and still failing → stop looping, shout ──────────────
assert_action alert "alerts instead of re-running a second time" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T14:20:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "completed", "conclusion": "failure", "attempt": 2}
  ]
}'

# ── A run still going is not drift, however old the commit ───────────────────
assert_action in_flight "quiet while a deploy run is still in progress" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T13:00:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "in_progress", "conclusion": null, "attempt": 1}
  ]
}'

# ── A run paused at the production gate: QA should already be synced ─────────
# spec-57 puts deploy-qa BEFORE approve-production, so a run waiting on a human
# has finished with QA. If QA is still behind, waiting is not the explanation.
assert_action alert "alerts when a gate-paused run left QA behind" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T13:00:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "waiting", "conclusion": null, "attempt": 1}
  ]
}'

# ── No run at all for main's tip → nothing will ever sync it ─────────────────
assert_action alert "alerts when no deploy run exists for main tip" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T13:00:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 999, "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
     "status": "completed", "conclusion": "success", "attempt": 1}
  ]
}'

# ── The liar case: run says success, QA says otherwise ───────────────────────
assert_action alert "alerts when a successful run did not move QA" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T13:00:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "completed", "conclusion": "success", "attempt": 1}
  ]
}'

# ── A cancelled run is a failed run for our purposes ─────────────────────────
# But NOT for `gh run rerun --failed`: a run cancelled before its jobs failed
# has no failed jobs, and that command errors out with nothing to re-run. The
# whole run has to go again.
CANCELLED_RUN='{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T13:00:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "completed", "conclusion": "cancelled", "attempt": 1}
  ]
}'
assert_output "rerun_mode=full" "re-runs a cancelled run whole, not just its failed jobs" "$CANCELLED_RUN"

assert_action rerun "re-runs a cancelled deploy" '{
  "now": "'"$NOW"'",
  "qaSha": "0fb4184b7ec8cf371cc29980f241df0434f53286",
  "mainSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
  "mainCommittedAt": "2026-08-17T13:00:00Z",
  "graceMinutes": 20,
  "runs": [
    {"databaseId": 32041150063, "headSha": "12bcf6c96a9c46be134875b06d70d1612cd4d466",
     "status": "completed", "conclusion": "cancelled", "attempt": 1}
  ]
}'

# ── Bad input must fail loudly, not decide "ok" ──────────────────────────────
if node "$SCRIPT" "$TMP/does-not-exist.json" >/dev/null 2>&1; then
  fail=$((fail + 1)); echo "  FAIL exits non-zero on a missing state file"
else
  pass=$((pass + 1)); echo "  ok   exits non-zero on a missing state file"
fi

printf '%s\n' '{"now":"2026-08-17T15:00:00Z","mainSha":"abc"}' > "$TMP/partial.json"
if node "$SCRIPT" "$TMP/partial.json" >/dev/null 2>&1; then
  fail=$((fail + 1)); echo "  FAIL exits non-zero when qaSha is missing"
else
  pass=$((pass + 1)); echo "  ok   exits non-zero when qaSha is missing"
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
