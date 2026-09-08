#!/usr/bin/env bash
#
# Tests for check-quarantine-validate.mjs (spec-87 fase 1) — quarantine.json's
# own shape: JSON validity, required fields, calendar-real dates, and the
# 30-day renewal horizon. Split out of check-quarantine.test.sh to keep both
# files under the repo's 300-line guideline; report-matching/expiry-logic
# tests stay there. Both drive the same CLI (check-quarantine.sh) — this file
# groups by which MODULE owns the behaviour, not by which script is invoked.
#
# Run: bash scripts/check-quarantine-validate.test.sh
set -uo pipefail

SCRIPT="$(dirname "$0")/check-quarantine.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# assert_exit <expected_code> <name> <today> <quarantine.json> <report.json>
assert_exit() {
  local expected="$1" name="$2" today="$3" quarantine="$4" report="$5" actual output
  printf '%s' "$quarantine" > "$TMP/quarantine.json"
  printf '%s' "$report" > "$TMP/report.json"
  output=$(bash "$SCRIPT" "$TMP/quarantine.json" "$TMP/report.json" --today "$today" 2>&1)
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

# assert_contains <needle> <name> <today> <quarantine.json> <report.json>
assert_contains() {
  local needle="$1" name="$2" today="$3" quarantine="$4" report="$5" output
  printf '%s' "$quarantine" > "$TMP/quarantine.json"
  printf '%s' "$report" > "$TMP/report.json"
  output=$(bash "$SCRIPT" "$TMP/quarantine.json" "$TMP/report.json" --today "$today" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "check-quarantine-validate.mjs"

PASSING_REPORT='{
  "suites": [],
  "stats": { "expected": 1, "unexpected": 0, "flaky": 0 }
}'

# ── Malformed quarantine JSON -> fails loudly, never in silence ─────────────
assert_exit 2 "malformed quarantine JSON fails loudly" \
  "2026-09-07" '{ not valid json' "$PASSING_REPORT"
assert_contains "not valid JSON" "names the JSON parse failure" \
  "2026-09-07" '{ not valid json' "$PASSING_REPORT"

# ── quarantine.json must be an array, not just valid JSON ───────────────────
# `Array.isArray` guards `.forEach`/`.filter` below it. Without a test, a
# mutant that drops the check survives every other assertion here — the file
# is still valid JSON, just the wrong shape — and the real failure mode is
# `forEach is not a function` (exit 1, no useful message) instead of this
# guard's own exit 2 with a clear reason.
assert_exit 2 "quarantine.json as an object, not an array, fails loudly" \
  "2026-09-07" '{}' "$PASSING_REPORT"
assert_contains "must be a JSON array" "names the array-shape requirement" \
  "2026-09-07" '{}' "$PASSING_REPORT"

# ── Required fields: each one individually, not just "reason" ──────────────
# Only "reason" had a test before this. Removing "owner" or "spec" or "test"
# from REQUIRED_FIELDS survived all of them.
MISSING_REASON='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "owner": "spec-78", "expires": "2026-09-21" }
]'
assert_exit 2 "quarantine entry missing \"reason\" fails loudly" \
  "2026-09-07" "$MISSING_REASON" "$PASSING_REPORT"
assert_contains "reason" "names the missing reason field" \
  "2026-09-07" "$MISSING_REASON" "$PASSING_REPORT"

MISSING_OWNER='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "reason": "x", "expires": "2026-09-21" }
]'
assert_exit 2 "quarantine entry missing \"owner\" fails loudly" \
  "2026-09-07" "$MISSING_OWNER" "$PASSING_REPORT"
assert_contains "owner" "names the missing owner field" \
  "2026-09-07" "$MISSING_OWNER" "$PASSING_REPORT"

MISSING_SPEC='[
  { "test": "2d — assigns the seeded truck",
    "reason": "x", "owner": "spec-78", "expires": "2026-09-21" }
]'
assert_exit 2 "quarantine entry missing \"spec\" fails loudly" \
  "2026-09-07" "$MISSING_SPEC" "$PASSING_REPORT"
assert_contains "spec" "names the missing spec field" \
  "2026-09-07" "$MISSING_SPEC" "$PASSING_REPORT"

MISSING_TEST='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts",
    "reason": "x", "owner": "spec-78", "expires": "2026-09-21" }
]'
assert_exit 2 "quarantine entry missing \"test\" fails loudly" \
  "2026-09-07" "$MISSING_TEST" "$PASSING_REPORT"
assert_contains "test" "names the missing test field" \
  "2026-09-07" "$MISSING_TEST" "$PASSING_REPORT"

# An empty string technically satisfies `typeof === 'string'` — the trim
# check is what catches it, and nothing exercised that branch before this.
EMPTY_OWNER='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "reason": "x", "owner": "", "expires": "2026-09-21" }
]'
assert_exit 2 "quarantine entry with an empty-string \"owner\" fails loudly" \
  "2026-09-07" "$EMPTY_OWNER" "$PASSING_REPORT"
assert_contains "owner" "names the empty owner field" \
  "2026-09-07" "$EMPTY_OWNER" "$PASSING_REPORT"

# ── Date sanity: passes the YYYY-MM-DD shape but is not a real date ─────────
BAD_CALENDAR_DATE='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "reason": "x", "owner": "spec-78", "expires": "2026-99-99" }
]'
assert_exit 2 "expires with an impossible calendar date fails loudly" \
  "2026-09-07" "$BAD_CALENDAR_DATE" "$PASSING_REPORT"
assert_contains "not a real date" "names the bad calendar date" \
  "2026-09-07" "$BAD_CALENDAR_DATE" "$PASSING_REPORT"

# ── Date sanity: quarantine cannot be renewed into the far future ───────────
FAR_FUTURE_DATE='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "reason": "x", "owner": "spec-78", "expires": "9999-12-31" }
]'
assert_exit 2 "expires more than 30 days out fails loudly" \
  "2026-09-07" "$FAR_FUTURE_DATE" "$PASSING_REPORT"
assert_contains "30 days" "names the horizon cap" \
  "2026-09-07" "$FAR_FUTURE_DATE" "$PASSING_REPORT"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
