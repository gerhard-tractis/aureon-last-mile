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
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
  verify-prod-migrations:
    needs: [changes, deploy-supabase]
  deploy-edge-functions:
    needs: [changes, approve-production, deploy-supabase]
  deploy-vercel:
    needs: [changes, approve-production, deploy-supabase, deploy-edge-functions]
  deploy-worker:
    needs: [changes, approve-production, deploy-supabase]
  deploy-agents:
    needs: [changes, approve-production, deploy-supabase]
  deploy-solver:
    needs: [changes, approve-production, deploy-supabase]'

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
  approve-production:
    needs: [changes, deploy-qa]
    environment:
      name: production
      url: https://aureon.tractis.ai
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

assert_exit 0 "accepts the object form of environment:" "$OBJECT_ENV"

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
