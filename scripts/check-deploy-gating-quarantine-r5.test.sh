#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-87 fase 1, re-review round 5) — H1
# (the whitelist was by LINE PREFIX, not by statement: `echo x; <bypass>`
# walked straight past round 4's `/^(#|echo\b)/`) and H2 (the M4 anchor —
# the step that runs `npm run e2e:qa` — passed in EMPTY when absent, and took
# the first textual mention, comments included). Split from
# check-deploy-gating-quarantine.test.sh / -r4.test.sh to stay under the
# repo's 300-line guideline; the fixture factory is duplicated here, matching
# how the other split test files in this family work.
# Run: bash scripts/check-deploy-gating-quarantine-r5.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/check-deploy-gating.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# assert_exit <expected_code> <test name> <workflow yaml>
assert_exit() {
  local expected="$1" name="$2" yaml="$3" actual output
  printf '%s\n' "$yaml" > "$TMP/wf.yml"
  output=$(bash "$SCRIPT" "$TMP/wf.yml" 2>&1)
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

# assert_contains <needle> <test name> <workflow yaml>
assert_contains() {
  local needle="$1" name="$2" yaml="$3" output
  printf '%s\n' "$yaml" > "$TMP/wf.yml"
  output=$(bash "$SCRIPT" "$TMP/wf.yml" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "check-deploy-gating.sh — quarantine veto step (round 5)"

# wf_with_e2e_step <step-yaml-indented-6-spaces> [job-level-lines-indented-4-spaces] [e2e-step-yaml-indented-6-spaces] -> full workflow on stdout
wf_with_e2e_step() {
  local step="$1" job_extra="${2:-}" e2e_step="${3:-      - name: Run E2E against QA
        run: npm run e2e:qa || true}"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n    needs: [changes, deploy-qa]\n'
  if [ -n "$job_extra" ]; then
    printf '%s\n' "$job_extra"
  fi
  printf '    steps:\n'
  if [ "$e2e_step" != "NONE" ]; then
    printf '%s\n' "$e2e_step"
  fi
  printf '%s\n' "$step"
  printf '  approve-production:\n    needs: [changes, deploy-qa, e2e-qa]\n    environment: production\n'
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
}

CLEAN_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'

# ── H1: `echo x; <bypass>` — the whitelist inspected only the first token ───
# of a logical line, never splitting on `;`/`&&`/`||`. Live-tested against
# this module with `bash --noprofile --norc -e -o pipefail` (how GitHub
# actually runs a step): all three below produced step exit 0 before this
# fix (echo was whitelisted; `logicalLines` never parts a line by `;`).
H1_TRAP_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          echo pre; trap '"'"'exit 0'"'"' EXIT
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$H1_TRAP_STEP")
assert_exit 1 "H1: fails on echo x; trap 'exit 0' EXIT chained after the echo" "$WF"

H1_SET_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          echo hi; set +e
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          echo done'
WF=$(wf_with_e2e_step "$H1_SET_STEP")
assert_exit 1 "H1: fails on echo x; set +e chained after the echo" "$WF"

H1_REDIRECT_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          echo '"'"'{"suites":[],"stats":{}}'"'"' > apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$H1_REDIRECT_STEP")
assert_exit 1 "H1: fails on echo ... > results.json forging a green report" "$WF"

H1_BARE_ECHO_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          echo running the check
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$H1_BARE_ECHO_STEP")
assert_exit 1 "H1: a bare echo line, with no chained bypass, is no longer whitelisted" "$WF"

# ── H2: the M4 anchor must exist, and must be a genuine, not a decoy ────────

# No step anywhere runs npm run e2e:qa (renamed to a direct playwright
# invocation) — before this fix, findIndex returned -1, read as "nothing to
# check position against", and the guard approved.
NO_E2E_STEP="      - name: Run E2E against QA
        run: npx playwright test --config=playwright.qa.config.ts || true"
WF=$(wf_with_e2e_step "$CLEAN_STEP" "" "$NO_E2E_STEP")
assert_exit 1 "H2: fails when no step in e2e-qa actually runs npm run e2e:qa" "$WF"
assert_contains "npm run e2e:qa" "H2: names the missing anchor" "$WF"

# Check quarantine is the ONLY step in the job — no Playwright step at all.
WF=$(wf_with_e2e_step "$CLEAN_STEP" "" "NONE")
assert_exit 1 "H2: fails when Check quarantine is the only step in e2e-qa" "$WF"

# The only mention of npm run e2e:qa is inside a `#` comment on an otherwise
# unrelated step, ahead of Check quarantine — the real Playwright step was
# deleted and this decoy comment must not stand in for it.
DECOY_COMMENT_STEP="      - name: Some other step
        run: |
          # npm run e2e:qa is below
          echo noop"
WF=$(wf_with_e2e_step "$CLEAN_STEP" "" "$DECOY_COMMENT_STEP")
assert_exit 1 "H2: a # comment mentioning the anchor does not count as the anchor" "$WF"

# Two steps run npm run e2e:qa, with Check quarantine sandwiched between
# them — the veto ran before the SECOND (real, current) invocation, which is
# still a stale-report bug. Anchoring on the FIRST match would miss this.
TWO_E2E_STEPS="      - name: Run E2E against QA (first)
        run: npm run e2e:qa || true
      - name: Check quarantine (misplaced)
        if: steps.qa.outputs.provisioned == 'true'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
      - name: Run E2E against QA (second)
        run: npm run e2e:qa || true"
printf 'jobs:\n  changes:\n    runs-on: ubuntu-latest\n  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n  e2e-qa:\n    needs: [changes, deploy-qa]\n    steps:\n%s\n  approve-production:\n    needs: [changes, deploy-qa, e2e-qa]\n    environment: production\n' "$TWO_E2E_STEPS" > "$TMP/two.yml"
for j in supabase edge-functions vercel worker agents solver; do
  printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j" >> "$TMP/two.yml"
done
output=$(bash "$SCRIPT" "$TMP/two.yml" 2>&1)
actual=$?
if [ "$actual" -eq 1 ]; then
  pass=$((pass + 1))
  echo "  ok   H2: with two e2e:qa steps, the anchor is the LAST one, not the first"
else
  fail=$((fail + 1))
  echo "  FAIL H2: with two e2e:qa steps, the anchor is the LAST one, not the first — expected exit 1, got $actual"
  printf '%s\n' "$output" | sed 's/^/         /'
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
