#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-92, round 2 — review 2026-09-09,
# PR #716) — six mutants survived the round-1 guard against the REAL
# deploy.yml even though every round-1 fixture-based test passed. Split
# from check-deploy-gating-autoapprove.test.sh to stay under the repo's
# 300-line guideline; the fixture factory is duplicated here, matching how
# the quarantine round files (r4/r5/r6) work.
#
# Run: bash scripts/check-deploy-gating-autoapprove-r2.test.sh
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
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — expected exit $expected, got $actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

assert_contains() {
  local needle="$1" name="$2" yaml="$3" output
  printf '%s\n' "$yaml" > "$TMP/wf.yml"
  output=$(bash "$SCRIPT" "$TMP/wf.yml" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "check-deploy-gating.sh — auto-approve shape (round 2)"

CHANGES_STEPS='    steps:
      - name: Filter paths
        run: |
          AUTH_HOOK=false
          if echo "$CHANGED" | grep -qE '"'"'custom_access_token_hook'"'"'; then AUTH_HOOK=true; fi
          if grep -qE '"'"'supabase_auth_admin'"'"' <<< "$MIGRATIONS_DIFF"; then AUTH_HOOK=true; fi
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"
          PG_NET=false
          if grep -qiE '"'"'net\s*\.\s*http|pg_net\b|schema\s+net\b'"'"' <<< "$MIGRATIONS_DIFF"; then PG_NET=true; fi
          echo "pg_net=${PG_NET}" >> "$GITHUB_OUTPUT"'

FRESH_STEP='    steps:
      - name: Verify this run is current
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          if [ "${MAIN_SHA}" != "${DEPLOY_SHA}" ]; then
            exit 1
          fi'

# base_wf <approve-production extra lines> <changes extra lines>
base_wf() {
  local approve_extra="${1:-}" changes_extra="${2:-}"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '    outputs:\n      auth_hook: ${{ steps.filter.outputs.auth_hook }}\n'
  printf '      pg_net: ${{ steps.filter.outputs.pg_net }}\n'
  if [ -n "$changes_extra" ]; then printf '%s\n' "$changes_extra"; else printf '%s\n' "$CHANGES_STEPS"; fi
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n'
  printf '    needs: [changes, deploy-qa]\n'
  printf '    steps:\n'
  printf '      - name: Run E2E against QA\n        run: npm run e2e:qa || true\n'
  printf "      - name: Check quarantine\n        if: steps.qa.outputs.provisioned == 'true'\n        working-directory: .\n        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json\n"
  printf '  approve-production:\n'
  printf '    needs: [changes, deploy-qa, e2e-qa]\n'
  printf "    environment: \${{ (needs.changes.outputs.auth_hook == 'true' || needs.changes.outputs.pg_net == 'true') && 'production' || 'production-auto' }}\n"
  if [ -n "$approve_extra" ]; then printf '%s\n' "$approve_extra"; else printf '%s\n' "$FRESH_STEP"; fi
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
}

GOOD="$(base_wf)"
assert_exit 0 "the full round-2 baseline fixture passes" "$GOOD"

# ── round-1 mutant 1: comparison neutralised, tokens still present ──────────
NEUTRALISED='    steps:
      - name: Verify this run is current
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          # commits/main DEPLOY_SHA exit 1 — tokens present as a decoy comment
          if [ "1" = "1" ]; then
            :
          else
            exit 1
          fi'
NEUTRALISED_WF="$(base_wf "$NEUTRALISED")"
assert_exit 1 "a neutralised comparison that keeps the tokens as decoys fails" "$NEUTRALISED_WF"
assert_contains "no \"run is current\" freshness step" "names the missing real comparison" "$NEUTRALISED_WF"

# ── round-1 mutant 2: if: false on the freshness step ────────────────────────
IF_FALSE_STEP='    steps:
      - name: Verify this run is current
        if: false
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          if [ "${MAIN_SHA}" != "${DEPLOY_SHA}" ]; then
            exit 1
          fi'
IF_FALSE_WF="$(base_wf "$IF_FALSE_STEP")"
assert_exit 1 "if: false on the freshness step fails" "$IF_FALSE_WF"
assert_contains "must run unconditionally" "names the conditional step" "$IF_FALSE_WF"

# ── round-1 mutant 3: continue-on-error on approve-production ITSELF ────────
JOB_LEVEL_COE="    continue-on-error: true
$FRESH_STEP"
JOB_COE_WF="$(base_wf "$JOB_LEVEL_COE")"
assert_exit 1 "continue-on-error: true on the gate JOB itself fails" "$JOB_COE_WF"
assert_contains "JOB level" "names the job-level continue-on-error" "$JOB_COE_WF"

# ── round-1 mutant 4: a brand-new production job, ungated, not in any list ──
NEW_UNGATED_JOB="  deploy-cdn-cache:
    runs-on: [self-hosted, vps]
    steps:
      - run: echo shipping"
NEW_JOB_WF="$(base_wf)
$NEW_UNGATED_JOB"
assert_exit 1 "a brand-new production job with no needs: at all is caught by default" "$NEW_JOB_WF"
assert_contains "deploy-cdn-cache does not depend on approve-production" "names the new ungated job by name, with no list to update" "$NEW_JOB_WF"

# ── round-1 mutant 5: delete auth_hook from changes.outputs ──────────────────
NO_AUTH_HOOK_OUTPUT_WF="jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      database: \${{ steps.filter.outputs.database }}
$CHANGES_STEPS
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
    environment: \${{ (needs.changes.outputs.auth_hook == 'true' || needs.changes.outputs.pg_net == 'true') && 'production' || 'production-auto' }}
$FRESH_STEP
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-vercel
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
assert_exit 1 "deleting auth_hook from changes.outputs fails" "$NO_AUTH_HOOK_OUTPUT_WF"
assert_contains "auth_hook is missing" "names the missing output" "$NO_AUTH_HOOK_OUTPUT_WF"

# ── round-1 mutant 6: delete the detection signals from the filter step ─────
BLIND_FILTER_STEP='    steps:
      - name: Filter paths
        run: |
          AUTH_HOOK=false
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"'
BLIND_WF="$(base_wf "" "$BLIND_FILTER_STEP")"
assert_exit 1 "deleting the detection signals from the filter step fails" "$BLIND_WF"
assert_contains "no longer references custom_access_token_hook" "names the removed path signal" "$BLIND_WF"
assert_contains "no longer references supabase_auth_admin" "names the removed migration-content signal" "$BLIND_WF"

# ── B3 mutant 5 (review round 2026-09-10): delete the WHOLE outputs: block ──
# from `changes`, not just the auth_hook key inside it — this is a different
# shape than round-1 mutant 5 above (NO_AUTH_HOOK_OUTPUT_WF keeps `outputs:`
# present, just incomplete). Deleting the block entirely used to skip check
# 4 altogether (it was gated on `changesJob.outputs` being truthy); now it
# gates on approve-production's environment actually reading those outputs.
NO_OUTPUTS_AT_ALL_WF="jobs:
  changes:
    runs-on: ubuntu-latest
$CHANGES_STEPS
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
    environment: \${{ (needs.changes.outputs.auth_hook == 'true' || needs.changes.outputs.pg_net == 'true') && 'production' || 'production-auto' }}
$FRESH_STEP
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-vercel
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
assert_exit 1 "deleting the ENTIRE outputs: block (not just a key) fails" "$NO_OUTPUTS_AT_ALL_WF"
assert_contains "auth_hook is missing" "names the missing auth_hook output" "$NO_OUTPUTS_AT_ALL_WF"
assert_contains "pg_net is missing" "names the missing pg_net output" "$NO_OUTPUTS_AT_ALL_WF"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
