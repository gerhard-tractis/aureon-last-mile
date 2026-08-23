#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-57).
# Run: bash scripts/check-deploy-gating.test.sh
#
# Fixtures are whole workflow skeletons rather than diffs of one another —
# the guard reads structure, so a fixture that is wrong in a way the test did
# not intend is worse than a slightly repetitive file.
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

echo "check-deploy-gating.sh"

# ── A correctly gated workflow ───────────────────────────────────────────────
GOOD='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
      cancel-in-progress: false
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  verify-prod-migrations:
    needs: [changes, deploy-supabase]
  deploy-edge-functions:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production, deploy-supabase, deploy-edge-functions]
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-solver'

assert_exit 0 "passes on a correctly gated workflow" "$GOOD"

# ── The regression this guard exists for ─────────────────────────────────────
UNGATED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-vercel:
    needs: [changes, deploy-supabase]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]'

assert_exit 1 "fails when a prod job does not need approve-production" "$UNGATED"
assert_contains "deploy-vercel does not depend on approve-production" \
  "names the ungated job" "$UNGATED"

# ── Gate present but never pauses ────────────────────────────────────────────
NO_ENV='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes, deploy-qa]
    runs-on: ubuntu-latest
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-vercel:
    needs: [changes, approve-production]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]'

assert_exit 1 "fails when approve-production has no environment" "$NO_ENV"

# ── Gate does not wait for QA ────────────────────────────────────────────────
NO_QA='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-vercel:
    needs: [changes, approve-production]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]'

assert_exit 1 "fails when approve-production does not need deploy-qa" "$NO_QA"

# ── Gate missing entirely (the pre-spec-57 state) ────────────────────────────
NO_GATE='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  deploy-vercel:
    needs: [changes]'

assert_exit 1 "fails when the gate job is absent" "$NO_GATE"
assert_contains "missing job: approve-production" "names the missing gate" "$NO_GATE"

# ── Shape tolerance: object-form environment and scalar needs ────────────────
OBJECT_ENV='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: changes
    concurrency: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment:
      name: production
      url: https://aureon.tractis.ai
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

assert_exit 0 "accepts the object form of environment:" "$OBJECT_ENV"

# ── QA must not be starved by a pending approval ─────────────────────────────
# A workflow-level concurrency group covers EVERY job, deploy-qa included. A run
# paused at approve-production keeps holding that group, so the next merge's QA
# sync cannot start — QA silently falls behind main for as long as nobody clicks
# approve. Observed 2026-08-16: #424 sat pending while #426 waited on approval.
WORKFLOW_CONCURRENCY='concurrency:
  group: production-deploy
  cancel-in-progress: false
jobs:
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
      group: production-deploy-solver'

assert_exit 1 "fails on a workflow-level concurrency group" "$WORKFLOW_CONCURRENCY"
assert_contains "workflow-level concurrency" \
  "explains that it starves deploy-qa" "$WORKFLOW_CONCURRENCY"

# ── Production still serialised, per job ─────────────────────────────────────
UNSERIALISED='jobs:
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

assert_exit 1 "fails when a prod job has no concurrency group of its own" "$UNSERIALISED"
assert_contains "deploy-supabase" "names the unserialised job" "$UNSERIALISED"

# ── QA sync must not race itself on the VPS ──────────────────────────────────
QA_UNSERIALISED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
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
      group: production-deploy-solver'

assert_exit 1 "fails when deploy-qa has no concurrency group" "$QA_UNSERIALISED"
assert_contains "deploy-qa" "names deploy-qa" "$QA_UNSERIALISED"

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

# ── Bad input ────────────────────────────────────────────────────────────────
if bash "$SCRIPT" "$TMP/does-not-exist.yml" >/dev/null 2>&1; then
  fail=$((fail + 1)); echo "  FAIL exits non-zero on a missing workflow file"
else
  pass=$((pass + 1)); echo "  ok   exits non-zero on a missing workflow file"
fi

# ── The real workflow must pass ──────────────────────────────────────────────
REAL="$(dirname "$0")/../.github/workflows/deploy.yml"
if bash "$SCRIPT" "$REAL" >/dev/null 2>&1; then
  pass=$((pass + 1)); echo "  ok   the committed deploy.yml is correctly gated"
else
  fail=$((fail + 1)); echo "  FAIL the committed deploy.yml is NOT correctly gated"
  bash "$SCRIPT" "$REAL" 2>&1 | sed 's/^/         /'
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
