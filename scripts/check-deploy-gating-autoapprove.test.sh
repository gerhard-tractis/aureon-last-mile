#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-92) — the auto-approve shape:
#   - approve-production.environment, when it is a conditional expression,
#     must map needs.changes.outputs.auth_hook == 'true' to 'production' and
#     everything else to 'production-auto' (never inverted, never the wrong
#     output)
#   - approve-production must carry a "run is current" freshness step that
#     cannot be swallowed by continue-on-error or a trailing `|| true`
#   - no PROD_JOBS job may declare its own environment: — that would let it
#     skip past approve-production's decision entirely
#
# A plain, unconditional `environment: production` (spec-57's original shape)
# is intentionally still accepted here — it is strictly MORE cautious than
# the auto-approve feature, not a safety regression, so the many pre-existing
# fixtures across the other check-deploy-gating-*.test.sh files that use it
# do not need to change. Only a malformed/inverted conditional, or an
# unconditional 'production-auto', is an error.
#
# The freshness-step and own-environment checks only fire when a fixture
# defines `steps:` on approve-production at all — matching this family's
# established convention ("Los fixtures de los tests son mínimos a
# propósito") of skipping when the relevant field is simply absent from a
# minimal fixture. The real deploy.yml always has `steps:`, so this is not a
# loophole there.
#
# Run: bash scripts/check-deploy-gating-autoapprove.test.sh
set -uo pipefail

SCRIPT="$(dirname "$0")/check-deploy-gating.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

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

echo "check-deploy-gating.sh — auto-approve shape (spec-92)"

# base_wf <environment-line> <approve-production-steps-block-or-NONE> <extra-job-block>
base_wf() {
  local env_line="$1" steps_block="$2" extra_job="${3:-}"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n'
  printf '    needs: [changes, deploy-qa]\n'
  printf '    steps:\n'
  printf '      - name: Run E2E against QA\n        run: npm run e2e:qa || true\n'
  printf "      - name: Check quarantine\n        if: steps.qa.outputs.provisioned == 'true'\n        working-directory: .\n        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json\n"
  printf '  approve-production:\n'
  printf '    needs: [changes, deploy-qa, e2e-qa]\n'
  printf '    %s\n' "$env_line"
  if [ "$steps_block" != "NONE" ]; then
    printf '%s\n' "$steps_block"
  fi
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
  if [ -n "$extra_job" ]; then
    printf '%s\n' "$extra_job"
  fi
}

FRESH_STEP='    steps:
      - name: Verify this run is current
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          if [ "${MAIN_SHA}" != "${DEPLOY_SHA}" ]; then
            exit 1
          fi'

CONDITIONAL_ENV="environment: \${{ needs.changes.outputs.auth_hook == 'true' && 'production' || 'production-auto' }}"
INVERTED_ENV="environment: \${{ needs.changes.outputs.auth_hook == 'true' && 'production-auto' || 'production' }}"
WRONG_FIELD_ENV="environment: \${{ needs.changes.outputs.database == 'true' && 'production' || 'production-auto' }}"
UNCONDITIONAL_AUTO_ENV="environment: production-auto"

GOOD_CONDITIONAL="$(base_wf "$CONDITIONAL_ENV" "$FRESH_STEP")"
GOOD_PLAIN="$(base_wf "environment: production" "$FRESH_STEP")"
GOOD_NO_STEPS="$(base_wf "$CONDITIONAL_ENV" "NONE")"

assert_exit 0 "conditional environment + freshness step passes" "$GOOD_CONDITIONAL"
assert_exit 0 "plain 'production' (no auto-approve, still safe) passes" "$GOOD_PLAIN"
assert_exit 0 "a minimal fixture with no steps: at all is not this check's problem" "$GOOD_NO_STEPS"

INVERTED="$(base_wf "$INVERTED_ENV" "$FRESH_STEP")"
assert_exit 1 "inverted conditional (auth_hook true -> production-auto) fails" "$INVERTED"
assert_contains "not the expected shape" "names the inverted expression" "$INVERTED"

WRONG_FIELD="$(base_wf "$WRONG_FIELD_ENV" "$FRESH_STEP")"
assert_exit 1 "conditional on the wrong output (database, not auth_hook) fails" "$WRONG_FIELD"

UNCONDITIONAL_AUTO="$(base_wf "$UNCONDITIONAL_AUTO_ENV" "$FRESH_STEP")"
assert_exit 1 "unconditional production-auto (always skips review) fails" "$UNCONDITIONAL_AUTO"

NO_FRESHNESS='    steps:
      - name: Record what is being approved
        run: echo hi'
MISSING_STEP="$(base_wf "$CONDITIONAL_ENV" "$NO_FRESHNESS")"
assert_exit 1 "steps: present but no freshness step fails" "$MISSING_STEP"
assert_contains "no \"run is current\" freshness step" "names the missing step" "$MISSING_STEP"

SWALLOWED_CONTINUE='    steps:
      - name: Verify this run is current
        continue-on-error: true
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          if [ "${MAIN_SHA}" != "${DEPLOY_SHA}" ]; then
            exit 1
          fi'
SWALLOWED_CE="$(base_wf "$CONDITIONAL_ENV" "$SWALLOWED_CONTINUE")"
assert_exit 1 "continue-on-error on the freshness step fails" "$SWALLOWED_CE"
assert_contains "continue-on-error" "names the swallowed step" "$SWALLOWED_CE"

SWALLOWED_OR_TRUE='    steps:
      - name: Verify this run is current
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          if [ "${MAIN_SHA}" != "${DEPLOY_SHA}" ]; then
            exit 1
          fi || true'
SWALLOWED_OT="$(base_wf "$CONDITIONAL_ENV" "$SWALLOWED_OR_TRUE")"
assert_exit 1 "a trailing || true on the freshness step fails" "$SWALLOWED_OT"

OWN_ENV_JOB='  deploy-vercel:
    needs: [changes, approve-production]
    environment: production-auto
    concurrency:
      group: production-deploy-vercel'
# base_wf already emits deploy-vercel once; append a redefinition is not
# valid YAML (duplicate key), so build this fixture by hand instead.
OWN_ENV_WF="jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  e2e-qa:
    needs: [changes, deploy-qa]
    steps:
      - name: Run E2E against QA
        run: npm run e2e:qa || true
      - name: Check quarantine
        if: steps.qa.outputs.provisioned == 'true'
        working-directory: .
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
  approve-production:
    needs: [changes, deploy-qa, e2e-qa]
    $CONDITIONAL_ENV
$FRESH_STEP
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
$OWN_ENV_JOB
  deploy-worker:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver"
assert_exit 1 "a PROD_JOBS job with its own environment fails" "$OWN_ENV_WF"
assert_contains "declares its own environment" "names the offending job" "$OWN_ENV_WF"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
