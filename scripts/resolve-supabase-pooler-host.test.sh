#!/usr/bin/env bash
#
# Tests for resolve-supabase-pooler-host.sh (spec-87 fase 4 follow-up,
# round 3 — reads the Management API's pooler config array instead of
# templating a hostname from the project's region).
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
    echo "  FAIL $name — expected stdout:"
    printf '%s\n' "$expected" | sed 's/^/           /'
    echo "       got:"
    printf '%s\n' "$output" | sed 's/^/           /'
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

# ── Happy path: single PRIMARY entry ────────────────────────────────────────
PRIMARY_ONLY='[{"identifier":"abc","database_type":"PRIMARY","is_using_scram_auth":true,"db_user":"postgres.wfwlcpnkkxxzdvhvvsxb","db_host":"aws-0-sa-east-1.pooler.supabase.com","db_port":6543,"db_name":"postgres","connection_string":"postgresql://postgres.wfwlcpnkkxxzdvhvvsxb:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres","connectionString":"deprecated","default_pool_size":15,"max_client_conn":200,"pool_mode":"transaction"}]'

assert_exit 0 "exits 0 for a single PRIMARY entry" "$PRIMARY_ONLY"
assert_stdout "$(printf 'db_host=aws-0-sa-east-1.pooler.supabase.com\ndb_port=6543\ndb_user=postgres.wfwlcpnkkxxzdvhvvsxb\npool_mode=transaction')" \
  "prints db_host/db_port/db_user/pool_mode as NAME=VALUE lines" "$PRIMARY_ONLY"

# ── Happy path: PRIMARY + a read replica — must pick PRIMARY, not the first
#    array element or the replica's fields ─────────────────────────────────
PRIMARY_AND_REPLICA='[{"identifier":"abc","database_type":"PRIMARY","is_using_scram_auth":true,"db_user":"postgres.wfwlcpnkkxxzdvhvvsxb","db_host":"aws-0-sa-east-1.pooler.supabase.com","db_port":6543,"db_name":"postgres","connection_string":"x","connectionString":"x","default_pool_size":15,"max_client_conn":200,"pool_mode":"transaction"},{"identifier":"def","database_type":"READ_REPLICA","is_using_scram_auth":true,"db_user":"postgres.wfwlcpnkkxxzdvhvvsxb","db_host":"aws-0-sa-east-1-replica.pooler.supabase.com","db_port":6543,"db_name":"postgres","connection_string":"x","connectionString":"x","default_pool_size":15,"max_client_conn":200,"pool_mode":"transaction"}]'

assert_exit 0 "exits 0 when PRIMARY sits alongside a read replica" "$PRIMARY_AND_REPLICA"
assert_stdout "$(printf 'db_host=aws-0-sa-east-1.pooler.supabase.com\ndb_port=6543\ndb_user=postgres.wfwlcpnkkxxzdvhvvsxb\npool_mode=transaction')" \
  "picks the PRIMARY entry's fields, not the replica's" "$PRIMARY_AND_REPLICA"

# ── Pretty-printed (multi-line) response — same object, different formatting
PRETTY='[
  {
    "identifier": "abc",
    "database_type": "PRIMARY",
    "db_user": "postgres.wfwlcpnkkxxzdvhvvsxb",
    "db_host": "aws-0-sa-east-1.pooler.supabase.com",
    "db_port": 6543,
    "pool_mode": "transaction"
  }
]'
assert_stdout "$(printf 'db_host=aws-0-sa-east-1.pooler.supabase.com\ndb_port=6543\ndb_user=postgres.wfwlcpnkkxxzdvhvvsxb\npool_mode=transaction')" \
  "parses a pretty-printed (multi-line) response the same as minified" "$PRETTY"

# ── pool_mode other than transaction — API wins, script still succeeds and
#    just reports it (a ::notice::, not an ::error::) ───────────────────────
SESSION_MODE='[{"identifier":"abc","database_type":"PRIMARY","db_user":"postgres.abc","db_host":"aws-0-x.pooler.supabase.com","db_port":5432,"pool_mode":"session"}]'
assert_exit 0 "exits 0 even when pool_mode is session, not transaction" "$SESSION_MODE"
assert_stdout "$(printf 'db_host=aws-0-x.pooler.supabase.com\ndb_port=5432\ndb_user=postgres.abc\npool_mode=session')" \
  "reports whatever pool_mode/db_port the API sent, unmodified" "$SESSION_MODE"
assert_contains "::notice::" "flags a non-transaction pool_mode with ::notice:: (not fatal)" "$SESSION_MODE"

# ── No PRIMARY entry in the array ───────────────────────────────────────────
REPLICA_ONLY='[{"identifier":"def","database_type":"READ_REPLICA","db_user":"postgres.abc","db_host":"aws-0-x.pooler.supabase.com","db_port":6543,"pool_mode":"transaction"}]'
assert_exit 1 "fails when no entry has database_type=PRIMARY" "$REPLICA_ONLY"
assert_contains "::error::" "reports an ::error:: annotation when PRIMARY is absent" "$REPLICA_ONLY"

EMPTY_ARRAY='[]'
assert_exit 1 "fails on an empty array" "$EMPTY_ARRAY"

# ── PRIMARY entry missing a required field ──────────────────────────────────
MISSING_HOST='[{"identifier":"abc","database_type":"PRIMARY","db_user":"postgres.abc","db_port":6543,"pool_mode":"transaction"}]'
assert_exit 1 "fails when PRIMARY is missing db_host" "$MISSING_HOST"
assert_contains "::error::" "reports an ::error:: annotation on a missing field" "$MISSING_HOST"
assert_contains "db_host" "names the missing field in the error" "$MISSING_HOST"

# ── Management API error body (e.g. 401/404 passed through by mistake) ──────
ERROR_BODY='{"message":"Invalid authentication credentials"}'
assert_exit 1 "fails on a Management API error body (not an array)" "$ERROR_BODY"
assert_contains "::error::" "reports an ::error:: annotation on an error body" "$ERROR_BODY"

# ── Malformed JSON ───────────────────────────────────────────────────────────
assert_exit 1 "fails on malformed JSON" "not json at all"
assert_contains "::error::" "reports an ::error:: annotation on malformed JSON" "not json at all"

echo ""
echo "resolve-supabase-pooler-host.sh: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
