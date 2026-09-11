#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-92 fase 1b / spec-93) — the pg_net
# class of auto-approve exemption, alongside auth_hook:
#   - approve-production.environment must route EITHER auth_hook == 'true'
#     OR pg_net == 'true' to 'production' (checked via VALID_CONDITIONAL_ENV
#     in check-deploy-gating-autoapprove.test.sh — not repeated here)
#   - changes.outputs.pg_net must exist and be wired to a real step
#   - the filter step must still compute pg_net= from the content signal
#     (net\.http_post / net\.http_get, escaped dot)
#
# Same convention as the rest of this family: checks only fire when a fixture
# declares the relevant field (outputs:/steps:) at all — minimal fixtures
# elsewhere in this suite are not this file's problem.
#
# Run: bash scripts/check-deploy-gating-pgnet.test.sh
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

echo "check-deploy-gating.sh — pg_net shape (spec-92 fase 1b / spec-93)"

ENV_LINE="environment: \${{ (needs.changes.outputs.auth_hook == 'true' || needs.changes.outputs.pg_net == 'true') && 'production' || 'production-auto' }}"

FRESH_STEP='    steps:
      - name: Verify this run is current
        run: |
          set -euo pipefail
          MAIN_SHA="$(gh api repos/x/y/commits/main --jq .sha)"
          if [ "${MAIN_SHA}" != "${DEPLOY_SHA}" ]; then
            exit 1
          fi'

FULL_FILTER_STEPS='    steps:
      - name: Filter paths
        run: |
          AUTH_HOOK=false
          if echo "$CHANGED" | grep -qE '"'"'custom_access_token_hook'"'"'; then AUTH_HOOK=true; fi
          if printf '"'"'%s'"'"' "$MIGRATIONS_DIFF" | grep -qE '"'"'supabase_auth_admin'"'"'; then AUTH_HOOK=true; fi
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"
          PG_NET=false
          if printf '"'"'%s'"'"' "$MIGRATIONS_DIFF" | grep -qE '"'"'net\.http_(post|get)'"'"'; then PG_NET=true; fi
          echo "pg_net=${PG_NET}" >> "$GITHUB_OUTPUT"'

# base_wf <changes-outputs-block> <changes-steps-block>
base_wf() {
  local outputs_block="$1" steps_block="$2"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '%s\n' "$outputs_block"
  printf '%s\n' "$steps_block"
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n'
  printf '    needs: [changes, deploy-qa]\n'
  printf '    steps:\n'
  printf '      - name: Run E2E against QA\n        run: npm run e2e:qa || true\n'
  printf "      - name: Check quarantine\n        if: steps.qa.outputs.provisioned == 'true'\n        working-directory: .\n        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json\n"
  printf '  approve-production:\n'
  printf '    needs: [changes, deploy-qa, e2e-qa]\n'
  printf '    %s\n' "$ENV_LINE"
  printf '%s\n' "$FRESH_STEP"
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
}

FULL_OUTPUTS='    outputs:
      auth_hook: ${{ steps.filter.outputs.auth_hook }}
      pg_net: ${{ steps.filter.outputs.pg_net }}'

GOOD="$(base_wf "$FULL_OUTPUTS" "$FULL_FILTER_STEPS")"
assert_exit 0 "baseline with pg_net wired end-to-end passes" "$GOOD"

# ── mutant: delete pg_net from changes.outputs ───────────────────────────────
AUTH_ONLY_OUTPUTS='    outputs:
      auth_hook: ${{ steps.filter.outputs.auth_hook }}'
NO_PG_NET_OUTPUT="$(base_wf "$AUTH_ONLY_OUTPUTS" "$FULL_FILTER_STEPS")"
assert_exit 1 "deleting pg_net from changes.outputs fails" "$NO_PG_NET_OUTPUT"
assert_contains "pg_net is missing" "names the missing output" "$NO_PG_NET_OUTPUT"

# ── mutant: pg_net declared as output, but no step ever computes it ─────────
AUTH_HOOK_ONLY_STEP='    steps:
      - name: Filter paths
        run: |
          AUTH_HOOK=false
          if echo "$CHANGED" | grep -qE '"'"'custom_access_token_hook'"'"'; then AUTH_HOOK=true; fi
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"'
NO_PG_NET_STEP="$(base_wf "$FULL_OUTPUTS" "$AUTH_HOOK_ONLY_STEP")"
assert_exit 1 "no step computing pg_net= fails" "$NO_PG_NET_STEP"
assert_contains "no step computing pg_net=" "names the missing computation" "$NO_PG_NET_STEP"

# ── mutant: the detection signal is removed, output always false ───────────
BLIND_PG_NET_STEP='    steps:
      - name: Filter paths
        run: |
          AUTH_HOOK=false
          if echo "$CHANGED" | grep -qE '"'"'custom_access_token_hook'"'"'; then AUTH_HOOK=true; fi
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"
          PG_NET=false
          echo "pg_net=${PG_NET}" >> "$GITHUB_OUTPUT"'
BLIND_PG_NET="$(base_wf "$FULL_OUTPUTS" "$BLIND_PG_NET_STEP")"
assert_exit 1 "removing the net.http_post/get detection signal fails" "$BLIND_PG_NET"
assert_contains 'no longer references net\.http_(post|get)' "names the removed signal" "$BLIND_PG_NET"

# ── mutant: signal present but with an unescaped dot (looser than intended) ─
UNESCAPED_DOT_STEP='    steps:
      - name: Filter paths
        run: |
          AUTH_HOOK=false
          if echo "$CHANGED" | grep -qE '"'"'custom_access_token_hook'"'"'; then AUTH_HOOK=true; fi
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"
          PG_NET=false
          if printf '"'"'%s'"'"' "$MIGRATIONS_DIFF" | grep -qE '"'"'nethttp_(post|get)'"'"'; then PG_NET=true; fi
          echo "pg_net=${PG_NET}" >> "$GITHUB_OUTPUT"'
UNESCAPED_DOT="$(base_wf "$FULL_OUTPUTS" "$UNESCAPED_DOT_STEP")"
assert_exit 1 "a mangled pattern missing the literal net\\.http_(post|get) fails" "$UNESCAPED_DOT"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
