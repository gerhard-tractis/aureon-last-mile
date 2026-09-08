#!/usr/bin/env bash
#
# Tests for check-quarantine.mjs's REPORT-shape checks (spec-87 fase 1) —
# report.errors, report.stats, and the empty/skipped-report cases (review
# round 2, H2/H4/H5). Split out of check-quarantine.test.sh, which keeps the
# quarantine-matching/expiry logic, to stay under the repo's 300-line
# guideline. Both drive the same CLI (check-quarantine.sh).
#
# Run: bash scripts/check-quarantine-report.test.sh
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

echo "check-quarantine.mjs — report shape"

DECLARED_ACTIVE='[
  { "spec": "e2e/despacho-tablet-dock.spec.ts",
    "test": "2d — assigns the seeded truck",
    "reason": "aserción usa el afordance móvil sobre el árbol de escritorio (spec-87 fase 2)",
    "owner": "spec-78", "expires": "2026-09-21" }
]'

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
