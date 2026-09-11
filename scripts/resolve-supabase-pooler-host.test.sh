#!/usr/bin/env bash
#
# Tests for resolve-supabase-pooler-host.sh (spec-87 fase 4 follow-up).
# Run: bash scripts/resolve-supabase-pooler-host.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/resolve-supabase-pooler-host.sh"
pass=0
fail=0

assert_exit() {
  local expected="$1" name="$2" fixture="$3" actual output
  output=$(printf '%s\n' "$fixture" | bash "$SCRIPT" 2>&1)
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

assert_stdout() {
  local expected="$1" name="$2" fixture="$3" output
  output=$(printf '%s\n' "$fixture" | bash "$SCRIPT" 2>/dev/null)
  if [ "$output" = "$expected" ]; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — expected stdout '$expected', got '$output'"
  fi
}

assert_contains() {
  local needle="$1" name="$2" fixture="$3" output
  output=$(printf '%s\n' "$fixture" | bash "$SCRIPT" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "resolve-supabase-pooler-host.sh"

# ── Happy path ──────────────────────────────────────────────────────────────
US_EAST='{"id":"wfwlcpnkkxxzdvhvvsxb","organization_id":"abc","name":"prod","region":"us-east-1","created_at":"2024-01-01T00:00:00Z","status":"ACTIVE_HEALTHY"}'

assert_exit 0 "exits 0 when region is present" "$US_EAST"
assert_stdout "aws-0-us-east-1.pooler.supabase.com" "prints the pooler host for us-east-1" "$US_EAST"

EU_WEST='{"id":"abc","region":"eu-west-2","status":"ACTIVE_HEALTHY"}'
assert_stdout "aws-0-eu-west-2.pooler.supabase.com" "prints the pooler host for eu-west-2" "$EU_WEST"

# ── Missing/null region ─────────────────────────────────────────────────────
NO_REGION='{"id":"abc","status":"ACTIVE_HEALTHY"}'
assert_exit 1 "fails when region is absent from the response" "$NO_REGION"
assert_contains "::error::" "reports an ::error:: annotation when region is absent" "$NO_REGION"

NULL_REGION='{"id":"abc","region":null}'
assert_exit 1 "fails when region is explicitly null" "$NULL_REGION"

# ── Management API error body (e.g. 401/404 passed through by mistake) ──────
ERROR_BODY='{"message":"Invalid authentication credentials"}'
assert_exit 1 "fails on a Management API error body" "$ERROR_BODY"
assert_contains "::error::" "reports an ::error:: annotation on an error body" "$ERROR_BODY"

# ── Malformed JSON ───────────────────────────────────────────────────────────
assert_exit 1 "fails on malformed JSON" "not json at all"

echo ""
echo "resolve-supabase-pooler-host.sh: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
