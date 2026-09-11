#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-92/spec-93, review round 2026-09-10,
# items 2 and 3) — split from -r2.test.sh to stay under the repo's 300-line
# guideline, matching how the quarantine round files (r4/r5/r6) work.
#
# Item 2: removing 'changes' from approve-production.needs does not touch
# the environment EXPRESSION at all — needs.changes.outputs.auth_hook still
# parses fine, but needs.changes doesn't exist in that job's context without
# 'changes' in needs:, so the whole condition silently and permanently
# resolves to 'production-auto'. Same failure as mutant 5 (the outputs:
# block deleted), reached from the needs: end of the wire instead.
#
# Item 3: changes.outputs.<field> names a step by id: (e.g.
# steps.filter.outputs.auth_hook), but nothing verified that id resolves to
# a real step, let alone one that computes that field. Renaming id: filter
# to id: filterX (run: untouched) left every presence check green while the
# output silently went dead.
#
# Run: bash scripts/check-deploy-gating-autoapprove-r3.test.sh
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

echo "check-deploy-gating.sh — auto-approve shape (round 3: items 2 and 3)"

CHANGES_STEPS='    steps:
      - name: Filter paths
        id: filter
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

# full_wf <changes-steps-block> <approve-production-needs-line>
full_wf() {
  local changes_steps="$1" gate_needs="$2"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '    outputs:\n      auth_hook: ${{ steps.filter.outputs.auth_hook }}\n'
  printf '      pg_net: ${{ steps.filter.outputs.pg_net }}\n'
  printf '%s\n' "$changes_steps"
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n'
  printf '    needs: [changes, deploy-qa]\n'
  printf '    steps:\n'
  printf '      - name: Run E2E against QA\n        run: npm run e2e:qa || true\n'
  printf "      - name: Check quarantine\n        if: steps.qa.outputs.provisioned == 'true'\n        working-directory: .\n        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json\n"
  printf '  approve-production:\n'
  printf '    needs: %s\n' "$gate_needs"
  printf "    environment: \${{ (needs.changes.outputs.auth_hook == 'true' || needs.changes.outputs.pg_net == 'true') && 'production' || 'production-auto' }}\n"
  printf '%s\n' "$FRESH_STEP"
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
}

GOOD="$(full_wf "$CHANGES_STEPS" "[changes, deploy-qa, e2e-qa]")"
assert_exit 0 "baseline (needs: changes present, id: filter present) passes" "$GOOD"

# ── item 2: 'changes' removed from approve-production.needs ─────────────────
NO_CHANGES_NEEDS="$(full_wf "$CHANGES_STEPS" "[deploy-qa, e2e-qa]")"
assert_exit 1 "removing 'changes' from approve-production.needs fails" "$NO_CHANGES_NEEDS"
assert_contains "is not in approve-production's own needs" "names the missing needs: entry" "$NO_CHANGES_NEEDS"

# ── item 3: id: filter renamed, outputs: left pointing at the old id ────────
RENAMED_ID_STEPS='    steps:
      - name: Filter paths
        id: filterX
        run: |
          AUTH_HOOK=false
          if echo "$CHANGED" | grep -qE '"'"'custom_access_token_hook'"'"'; then AUTH_HOOK=true; fi
          if grep -qE '"'"'supabase_auth_admin'"'"' <<< "$MIGRATIONS_DIFF"; then AUTH_HOOK=true; fi
          echo "auth_hook=${AUTH_HOOK}" >> "$GITHUB_OUTPUT"
          PG_NET=false
          if grep -qiE '"'"'net\s*\.\s*http|pg_net\b|schema\s+net\b'"'"' <<< "$MIGRATIONS_DIFF"; then PG_NET=true; fi
          echo "pg_net=${PG_NET}" >> "$GITHUB_OUTPUT"'
RENAMED_ID_WF="$(full_wf "$RENAMED_ID_STEPS" "[changes, deploy-qa, e2e-qa]")"
assert_exit 1 "renaming id: filter to id: filterX (run: untouched) fails" "$RENAMED_ID_WF"
assert_contains "references steps.filter, but no step in changes declares id: filter" \
  "names the unbound auth_hook output" "$RENAMED_ID_WF"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
