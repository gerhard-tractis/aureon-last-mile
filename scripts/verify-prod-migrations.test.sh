#!/usr/bin/env bash
#
# Tests for verify-prod-migrations.sh (spec-51).
# Run: bash scripts/verify-prod-migrations.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/verify-prod-migrations.sh"
pass=0
fail=0

# assert_exit <expected_code> <test name> <stdin fixture>
assert_exit() {
  local expected="$1" name="$2" fixture="$3" actual output
  output=$(printf '%s\n' "$fixture" | bash "$SCRIPT" 2>&1)
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — expected exit $expected, got $actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

assert_contains() {
  local needle="$1" name="$2" fixture="$3" output
  output=$(printf '%s\n' "$fixture" | bash "$SCRIPT" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "verify-prod-migrations.sh"

# ── In sync ─────────────────────────────────────────────────────────────────
IN_SYNC='Connecting to remote database...

        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼─────────────────────
    20250107210416 │ 20250107210416 │ 2025-01-07 21:04:16
    20260209000004 │ 20260209000004 │ 2026-02-09 00:00:04
    20260806000001 │ 20260806000001 │ 2026-08-06 00:00:01'

assert_exit 0 "passes when every migration is applied" "$IN_SYNC"
assert_contains "3 migrations applied" "reports the applied count" "$IN_SYNC"

# ── Prod behind the repo (the path-filter failure mode) ─────────────────────
PROD_BEHIND='        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼─────────────────────
    20250107210416 │ 20250107210416 │ 2025-01-07 21:04:16
    20260806000001 │                │ 2026-08-06 00:00:01'

assert_exit 1 "fails when a repo migration is not applied to prod" "$PROD_BEHIND"
assert_contains "20260806000001" "names the unapplied migration" "$PROD_BEHIND"
assert_contains "Production is BEHIND" "explains prod is behind" "$PROD_BEHIND"

# ── Migration applied by hand, absent from the repo ─────────────────────────
APPLIED_BY_HAND='        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼─────────────────────
    20250107210416 │ 20250107210416 │ 2025-01-07 21:04:16
                   │ 20260901000000 │ 2026-09-01 00:00:00'

assert_exit 1 "fails on a migration applied outside the repo" "$APPLIED_BY_HAND"
assert_contains "applied them by hand" "explains the manual change" "$APPLIED_BY_HAND"

# ── Both directions at once ─────────────────────────────────────────────────
BOTH='        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼─────────────────────
    20260806000001 │                │ 2026-08-06 00:00:01
                   │ 20260901000000 │ 2026-09-01 00:00:00'

assert_exit 1 "fails when drift runs in both directions" "$BOTH"

# ── ASCII pipe separators (older CLI builds) ────────────────────────────────
ASCII_PIPES='        LOCAL      |     REMOTE     |     TIME (UTC)
  ---------------- | -------------- | -------------------
    20250107210416 | 20250107210416 | 2025-01-07 21:04:16'

assert_exit 0 "handles ASCII pipe separators" "$ASCII_PIPES"

# ── The vacuous pass — the trap this gate must not fall into ────────────────
# If the CLI output format changes, the parser finds nothing. Passing here would
# make the gate permanently green and useless, so it must fail instead.
assert_exit 1 "fails when no rows can be parsed" "some unexpected new format"
assert_exit 1 "fails on empty input" ""
assert_contains "not verifying anything" "explains the parse failure" "totally different output"

# ── Header-only output must not count as success ────────────────────────────
HEADER_ONLY='        LOCAL      │     REMOTE     │     TIME (UTC)
  ─────────────────┼────────────────┼─────────────────────'

assert_exit 1 "fails when only headers are present" "$HEADER_ONLY"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
