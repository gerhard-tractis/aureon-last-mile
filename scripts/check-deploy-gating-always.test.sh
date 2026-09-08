#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-57) — the always() gate bypass and
# the deploy-supabase path filter. Split out of
# check-deploy-gating-concurrency.test.sh to stay under the repo's 300-line
# guideline; both drive the same CLI.
# Run: bash scripts/check-deploy-gating-always.test.sh
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

echo "check-deploy-gating.sh — always() and path filters"

# ── needs: is not enough when if: uses always() ──────────────────────────────
# Observed 2026-08-17, run 32066950544: approve-production was SKIPPED (its own
# needs had been cancelled), and deploy-vercel ran `vercel --prod` anyway. It
# listed the gate in needs:, so the guard above was satisfied — but always()
# overrides the implicit "a skipped need skips the job", and a skipped job is
# neither failure() nor cancelled(). Production shipped with nobody approving.
#
# So a prod job that opts into always() must say out loud that the gate passed.
ALWAYS_BYPASS='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled()
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled()
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled()
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
      group: production-deploy-solver'

assert_exit 1 "fails when always() lets a skipped gate through" "$ALWAYS_BYPASS"
assert_contains "deploy-vercel" "names the job that can bypass the gate" "$ALWAYS_BYPASS"

# The same shape, but each always() job asserts the gate actually succeeded.
# This is the form the real workflow has to use: the other needs (deploy-supabase,
# deploy-edge-functions) are legitimately skipped by the path filters, so plain
# success() semantics are not available — always() has to stay.
ALWAYS_GATED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    if: always() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 0 "accepts always() when the gate result is asserted" "$ALWAYS_GATED"

# ── deploy-supabase path-filtered ────────────────────────────────────────────
# The shape production actually drifted in: a migration's run waits at the gate,
# docs-only merges land behind it, and the run that finally gets approved has no
# migration in its diff — so the job skips and nothing deploys.
PATH_FILTERED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
    runs-on: ubuntu-latest
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
    if: |
      needs.approve-production.result == '"'"'success'"'"' &&
      needs.changes.outputs.database == '"'"'true'"'"'
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
      group: production-deploy-solver'

assert_exit 1 "fails when deploy-supabase is path-filtered" "$PATH_FILTERED"
assert_contains "path-filtered on changes.outputs.database" \
  "explains why the filter is the bug" "$PATH_FILTERED"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
