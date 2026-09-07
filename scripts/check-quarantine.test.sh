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
  ]
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
  ]
}'
assert_exit 1 "quarantined test now passes -> gate fails" \
  "2026-09-07" "$DECLARED_ACTIVE" "$PASSING_REPORT"
assert_contains "Retire it" "asks for the stale entry to be retired" \
  "2026-09-07" "$DECLARED_ACTIVE" "$PASSING_REPORT"

# ── Malformed quarantine JSON -> fails loudly, never in silence ─────────────
assert_exit 2 "malformed quarantine JSON fails loudly" \
  "2026-09-07" '{ not valid json' "$PASSING_REPORT"
assert_contains "not valid JSON" "names the JSON parse failure" \
  "2026-09-07" '{ not valid json' "$PASSING_REPORT"

# ── Quarantine entry missing a required field -> fails loudly ──────────────
MISSING_FIELD='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "owner": "spec-78", "expires": "2026-09-21" }
]'
assert_exit 2 "quarantine entry missing \"reason\" fails loudly" \
  "2026-09-07" "$MISSING_FIELD" "$PASSING_REPORT"
assert_contains "reason" "names the missing field" \
  "2026-09-07" "$MISSING_FIELD" "$PASSING_REPORT"

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

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
