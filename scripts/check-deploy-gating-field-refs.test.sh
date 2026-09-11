#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-92/spec-93, review round 2026-09-10,
# G2 + round 5) — split from check-deploy-gating.test.sh to stay under the
# repo's 300-line guideline.
#
# G2: a production job's if: reads a needs.changes.outputs.<field> that
# changes.outputs doesn't actually have — a typo or a field renamed on one
# side only. It reads as '' forever, so the job never runs, on every push,
# with every OTHER check here green (it does depend on approve-production,
# the gate is real, everything else is fine).
#
# round 5: the same typo, but in a STEP-level env: — deploy-qa's real
# "Sync QA environment" step passes needs.changes.outputs.worker to
# deploy-qa.sh as CHANGED_WORKER; a typo there means QA silently never
# rebuilds the worker, and e2e-qa (the precondition approve-production
# trusts) runs green against a stale one.
#
# Run: bash scripts/check-deploy-gating-field-refs.test.sh
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

echo "check-deploy-gating.sh — changes.outputs field references (G2 / round 5)"

TYPO_FIELD='jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      worker: ${{ steps.filter.outputs.worker }}
  deploy-qa:
    needs: [changes]
    concurrency: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency: production-deploy-worker
    if: needs.changes.outputs.workerz == '"'"'true'"'"'
  deploy-agents:
    needs: [changes, approve-production]
    concurrency: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency: production-deploy-solver'

assert_exit 1 "fails when a prod job's if: reads a changes.outputs field that doesn't exist" "$TYPO_FIELD"
assert_contains "deploy-worker's if: reads needs.changes.outputs.workerz, but changes.outputs has no workerz key" \
  "names the job and the typo'd field" "$TYPO_FIELD"

TYPO_ENV_FIELD='jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      worker: ${{ steps.filter.outputs.worker }}
  deploy-qa:
    needs: [changes]
    concurrency: qa-deploy
    steps:
      - name: Sync QA environment
        run: bash infra/supabase-qa/deploy-qa.sh
        env:
          CHANGED_WORKER: ${{ needs.changes.outputs.workerz }}
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency: production-deploy-solver'

assert_exit 1 "fails when a step-level env: reads a changes.outputs field that doesn't exist" "$TYPO_ENV_FIELD"
assert_contains "deploy-qa's steps[0].env.CHANGED_WORKER reads needs.changes.outputs.workerz, but changes.outputs has no workerz key" \
  "names the job, the step, and the typo'd field" "$TYPO_ENV_FIELD"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
