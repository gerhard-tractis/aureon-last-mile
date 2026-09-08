#!/usr/bin/env bash
#
# Tests for check-quarantine.sh (spec-87 fase 1).
# Run: bash scripts/check-quarantine.test.sh
#
# Fixtures are a quarantine.json + a minimal Playwright JSON-reporter report,
# both written fresh per assertion so each test is self-contained.
#
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

echo "check-quarantine.sh"

# ── A report with one failing spec, declared and still within its expiry ────
ONE_FAILING_REPORT='{
  "suites": [
    {
      "title": "despacho-tablet-dock.spec.ts",
      "suites": [
        {
          "title": "spec-78 Despacho dock tablet — 3a",
          "specs": [
            {
              "file": "e2e/despacho-tablet-dock.spec.ts",
              "title": "2d — assigns the seeded truck at the dock viewport, before the flag is set",
              "ok": false,
              "tests": [ { "results": [ { "status": "failed" } ] } ]
            }
          ]
        }
      ],
      "specs": []
    }
  ],
  "stats": { "expected": 0, "unexpected": 1, "flaky": 0 }
}'

DECLARED_ACTIVE='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts",
    "test": "2d — assigns the seeded truck",
    "reason": "aserción usa el afordance móvil sobre el árbol de escritorio (spec-87 fase 2)",
    "owner": "spec-78", "expires": "2026-09-21" }
]'

assert_exit 0 "declared failure, active quarantine entry -> gate passes" \
  "2026-09-07" "$DECLARED_ACTIVE" "$ONE_FAILING_REPORT"

# ── Undeclared failure -> gate fails ─────────────────────────────────────────
assert_exit 1 "undeclared failure -> gate fails" "2026-09-07" "[]" "$ONE_FAILING_REPORT"
assert_contains "undeclared failure" "names it as an undeclared failure" \
  "2026-09-07" "[]" "$ONE_FAILING_REPORT"

# ── Expired entry -> gate fails, even though the test still fails ───────────
DECLARED_EXPIRED='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts",
    "test": "2d — assigns the seeded truck",
    "reason": "aserción usa el afordance móvil sobre el árbol de escritorio (spec-87 fase 2)",
    "owner": "spec-78", "expires": "2026-01-01" }
]'
assert_exit 1 "expired entry -> gate fails even though the test still fails" \
  "2026-09-07" "$DECLARED_EXPIRED" "$ONE_FAILING_REPORT"
assert_contains "expired" "names the expiry as the reason" \
  "2026-09-07" "$DECLARED_EXPIRED" "$ONE_FAILING_REPORT"

# ── Entry whose test now PASSES -> gate fails, asking for retirement ────────
PASSING_REPORT='{
  "suites": [
    {
      "title": "despacho-tablet-dock.spec.ts",
      "suites": [
        {
          "title": "spec-78 Despacho dock tablet — 3a",
          "specs": [
            {
              "file": "e2e/despacho-tablet-dock.spec.ts",
              "title": "2d — assigns the seeded truck at the dock viewport, before the flag is set",
              "ok": true,
              "tests": [ { "results": [ { "status": "passed" } ] } ]
            }
          ]
        }
      ],
      "specs": []
    }
  ],
  "stats": { "expected": 1, "unexpected": 0, "flaky": 0 }
}'
assert_exit 1 "quarantined test now passes -> gate fails" \
  "2026-09-07" "$DECLARED_ACTIVE" "$PASSING_REPORT"
assert_contains "Retire it" "asks for the stale entry to be retired" \
  "2026-09-07" "$DECLARED_ACTIVE" "$PASSING_REPORT"

# Malformed JSON, missing required fields, calendar-real dates, and the
# 30-day horizon are check-quarantine-validate.mjs's own shape checks — see
# check-quarantine-validate.test.sh.

# ── No failures at all, no quarantine entries -> passes clean ──────────────
assert_exit 0 "clean report, empty quarantine -> passes" \
  "2026-09-07" "[]" "$PASSING_REPORT"

# ── Missing report file -> fails loudly, not silently green ────────────────
printf '%s' "[]" > "$TMP/quarantine.json"
output=$(bash "$SCRIPT" "$TMP/quarantine.json" "$TMP/does-not-exist.json" --today "2026-09-07" 2>&1)
actual=$?
if [ "$actual" -ne 0 ]; then
  pass=$((pass + 1)); echo "  ok   missing report file fails loudly"
else
  fail=$((fail + 1)); echo "  FAIL missing report file should not exit 0"
fi

# report.errors and stats.unexpected cross-checks live in
# check-quarantine-report.test.sh, alongside the H2/H3 empty-report cases.

# ── Ambiguous entry: "test" text matches more than one spec ─────────────────
# An entry with a text loose enough to match two real tests could silently
# absorb a second, unrelated regression.
TWO_ROUTE_TESTS_REPORT='{
  "suites": [
    {
      "title": "despacho-close-dispatch.spec.ts",
      "suites": [
        {
          "title": "spec-77/79",
          "specs": [
            { "file": "e2e/despacho-close-dispatch.spec.ts", "title": "Route H — load, force-close a split order, dispatch: full path + H3", "ok": false, "tests": [ { "results": [ { "status": "failed" } ] } ] },
            { "file": "e2e/despacho-close-dispatch.spec.ts", "title": "Route R — DispatchTrack rejects: 2k names what did NOT change, Reintentar is primary", "ok": false, "tests": [ { "results": [ { "status": "failed" } ] } ] }
          ]
        }
      ],
      "specs": []
    }
  ],
  "stats": { "expected": 0, "unexpected": 2, "flaky": 0 }
}'
AMBIGUOUS_ENTRY='[
  { "spec": "e2e/despacho-close-dispatch.spec.ts", "test": "Route",
    "reason": "too broad on purpose for this test", "owner": "spec-79", "expires": "2026-09-21" }
]'
assert_exit 1 "quarantine entry matching more than one spec -> gate fails" \
  "2026-09-07" "$AMBIGUOUS_ENTRY" "$TWO_ROUTE_TESTS_REPORT"
assert_contains "matches 2 tests" "names the ambiguity" \
  "2026-09-07" "$AMBIGUOUS_ENTRY" "$TWO_ROUTE_TESTS_REPORT"

# ── Expiry boundary: expires == today is still active, not expired ─────────
# `e.expires < today` mutated to `<=` survived every test here: with
# expires: 2026-09-07 and --today 2026-09-07 the gate passed either way,
# because no fixture ever sat exactly on the boundary. An entry is meant to
# stay usable through its expiry date and lapse the day after.
EXPIRES_TODAY='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts",
    "test": "2d — assigns the seeded truck",
    "reason": "aserción usa el afordance móvil sobre el árbol de escritorio (spec-87 fase 2)",
    "owner": "spec-78", "expires": "2026-09-07" }
]'
assert_exit 0 "an entry expiring exactly today is still active, not expired" \
  "2026-09-07" "$EXPIRES_TODAY" "$ONE_FAILING_REPORT"

EXPIRES_YESTERDAY='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts",
    "test": "2d — assigns the seeded truck",
    "reason": "aserción usa el afordance móvil sobre el árbol de escritorio (spec-87 fase 2)",
    "owner": "spec-78", "expires": "2026-09-06" }
]'
assert_exit 1 "an entry that expired yesterday fails the gate" \
  "2026-09-07" "$EXPIRES_YESTERDAY" "$ONE_FAILING_REPORT"
assert_contains "expired" "names the expiry as the reason, one day past" \
  "2026-09-07" "$EXPIRES_YESTERDAY" "$ONE_FAILING_REPORT"

# ── Success message names what it forgave, not just a count ────────────────
assert_contains "despacho-tablet-dock.spec.ts" "success message names the forgiven spec" \
  "2026-09-07" "$DECLARED_ACTIVE" "$ONE_FAILING_REPORT"

# The empty/all-skipped/blank-report cases (H2) and the --validate-only
# expiry warning (H3) live in check-quarantine-report.test.sh.

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
