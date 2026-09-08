#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-57) — per-job concurrency groups.
# Split out of check-deploy-gating.test.sh to stay under the repo's
# 300-line guideline; both drive the same CLI. The always()-bypass and
# path-filter tests live in check-deploy-gating-always.test.sh.
# Run: bash scripts/check-deploy-gating-concurrency.test.sh
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

echo "check-deploy-gating.sh — concurrency groups"

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

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
