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

# ── report.errors: a file that fails to LOAD produces no failing specs ──────
# review round 1, blocker 1 — demonstrated against a real Playwright 1.58.2
# run: a broken import shows up ONLY in report.errors + report.stats.unexpected,
# never as a failing spec. Confirmed the reverse too: with a good report.errors
# check but no cross-check on stats.unexpected, a partial suites[] (only the
# files that DID load) plus a non-empty errors[] must still fail the gate even
# when every visible spec is declared.
BROKEN_LOAD_REPORT='{
  "errors": [ { "message": "Cannot find module '"'"'./support/reception-mobile-fixture'"'"'" } ],
  "stats": { "unexpected": 2 },
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
assert_exit 1 "report.errors non-empty -> gate fails even if every visible spec is declared" \
  "2026-09-07" "$DECLARED_ACTIVE" "$BROKEN_LOAD_REPORT"
assert_contains "Cannot find module" "surfaces the load error" \
  "2026-09-07" "$DECLARED_ACTIVE" "$BROKEN_LOAD_REPORT"

# ── stats.unexpected > failing specs found -> something didn't surface ──────
STATS_MISMATCH_REPORT='{
  "errors": [],
  "stats": { "unexpected": 3 },
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
assert_exit 1 "stats.unexpected greater than failing specs found -> gate fails" \
  "2026-09-07" "$DECLARED_ACTIVE" "$STATS_MISMATCH_REPORT"
assert_contains "stats.unexpected" "names the stats mismatch" \
  "2026-09-07" "$DECLARED_ACTIVE" "$STATS_MISMATCH_REPORT"

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

# ── Success message names what it forgave, not just a count ────────────────
assert_contains "despacho-tablet-dock.spec.ts" "success message names the forgiven spec" \
  "2026-09-07" "$DECLARED_ACTIVE" "$ONE_FAILING_REPORT"

# ── H2 (review round 2): an EMPTY report must not be green ──────────────────
# Nothing in the parser ever checked that a test actually ran. Before this
# fix, the only thing standing between an empty report and a green gate was
# quarantine.json having active entries that then fail to match anything —
# coverage that vanishes the day fase 2 empties the file, which is exactly
# the day production unblocks. A test.describe.skip, or a rename that breaks
# testMatch, would leave e2e-qa green forever with zero tests executed.
EMPTY_REPORT_ZERO_STATS='{ "suites": [], "errors": [], "stats": { "expected": 0, "unexpected": 0, "flaky": 0 } }'
assert_exit 1 "empty report with zero stats -> gate fails even with empty quarantine" \
  "2026-09-07" "[]" "$EMPTY_REPORT_ZERO_STATS"
assert_contains "no test" "names the empty-report case" \
  "2026-09-07" "[]" "$EMPTY_REPORT_ZERO_STATS"

BLANK_REPORT='{}'
assert_exit 1 "a completely blank report ({}) -> gate fails" \
  "2026-09-07" "[]" "$BLANK_REPORT"

# All results "skipped" — allSpecs is non-empty, but nothing was actually
# executed. stats.expected/unexpected/flaky all stay at 0 for a skip.
ALL_SKIPPED_REPORT='{
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
              "tests": [ { "results": [ { "status": "skipped" } ] } ]
            }
          ]
        }
      ],
      "specs": []
    }
  ],
  "stats": { "expected": 0, "unexpected": 0, "flaky": 0 }
}'
assert_exit 1 "a report where every test was skipped -> gate fails" \
  "2026-09-07" "[]" "$ALL_SKIPPED_REPORT"

# A real run must still pass: stats carry at least one expected/unexpected/flaky.
assert_exit 0 "a report with a real passing test still passes" \
  "2026-09-07" "[]" "$PASSING_REPORT"

# ── H3 (review round 2): --validate-only warns, but does not fail, on an
# already-expired entry. It has no report and cannot know if the test still
# fails, so it must not block the PR over this — but silence here means every
# PR stays green from the day an entry expires until the next VPS e2e-qa run
# catches it, by which point production is already re-blocked.
EXPIRED_ENTRY='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck",
    "reason": "x", "owner": "spec-78", "expires": "2020-01-01" }
]'
printf '%s' "$EXPIRED_ENTRY" > "$TMP/quarantine.json"
output=$(node "$(dirname "$0")/check-quarantine.mjs" --validate-only "$TMP/quarantine.json" --today "2026-09-07" 2>&1)
actual=$?
if [ "$actual" -eq 0 ]; then
  pass=$((pass + 1)); echo "  ok   --validate-only does not fail on an already-expired entry"
else
  fail=$((fail + 1)); echo "  FAIL --validate-only should not fail (no report to check against), got exit $actual"
  printf '%s\n' "$output" | sed 's/^/         /'
fi
if printf '%s' "$output" | grep -qF "::warning::"; then
  pass=$((pass + 1)); echo "  ok   --validate-only warns about the already-expired entry"
else
  fail=$((fail + 1)); echo "  FAIL --validate-only did not warn about the already-expired entry"
  printf '%s\n' "$output" | sed 's/^/         /'
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
