#!/usr/bin/env bash
#
# Tests for apply_seed() in deploy-qa.sh.
#
# QA dock zones were added to seed-qa.sql and never appeared, because the
# deploy replayed migrations but never seeded — seeding only ever happened in
# setup-qa.sh, the one-time bootstrap. Every seed change since has silently
# needed someone to SSH in. These tests stub `psql` so the behaviour is
# verifiable without a VPS.
#
# Run: bash infra/supabase-qa/deploy-qa.seed.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

pass=0
fail=0

check() { # $1 name, $2 expected exit, $3 actual exit
  if [ "$2" -eq "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected exit $2, got $3"
  fi
}

check_contains() { # $1 name, $2 haystack, $3 needle
  if printf '%s' "$2" | grep -q -- "$3"; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected to find '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  fi
}

# A `psql` stub that records its argv and exits with $PSQL_EXIT.
cat > "$STUB_DIR/psql" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PSQL_LOG"
exit "${PSQL_EXIT:-0}"
STUB
chmod +x "$STUB_DIR/psql"
export PATH="$STUB_DIR:$PATH"

# A fake QA checkout: the env file the script reads its password from, and a
# seed file at the path apply_seed derives from QA_CHECKOUT_DIR.
FAKE_QA="$STUB_DIR/qa"
mkdir -p "$FAKE_QA/packages/database/supabase"
SEED_PATH="$FAKE_QA/packages/database/supabase/seed-qa.sql"
echo "SELECT 1;" > "$SEED_PATH"

export QA_CHECKOUT_DIR="$FAKE_QA"
export QA_ENV_FILE="$STUB_DIR/.env.qa"
printf 'POSTGRES_PASSWORD=s3cret\n' > "$QA_ENV_FILE"

# Source only the pieces under test, so sourcing cannot trigger the script's
# own setup. Mirrors deploy-qa.guard-sudo.test.sh.
extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  echo "QA_CHECKOUT_DIR=\"$FAKE_QA\""
  echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
  extract log
  extract err
  extract env_get
  extract apply_seed
} > "$STUB_DIR/apply_seed.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/apply_seed.sh"

echo "apply_seed()"

# ── The seed actually runs ──────────────────────────────────────────────────
PSQL_LOG="$STUB_DIR/log1"; export PSQL_LOG
: > "$PSQL_LOG"
PSQL_EXIT=0 apply_seed >/dev/null 2>&1
check "runs the seed on a normal deploy" 0 $?

invocation="$(cat "$PSQL_LOG")"
check_contains "passes the seed file to psql" "$invocation" "seed-qa.sql"
check_contains "targets the QA database port" "$invocation" "5433"

# A seed that half-applies is worse than one that fails: without ON_ERROR_STOP
# psql reports success after skipping failed statements.
check_contains "stops on the first SQL error" "$invocation" "ON_ERROR_STOP=1"

# ── A failing seed must not be swallowed ────────────────────────────────────
PSQL_LOG="$STUB_DIR/log2"; export PSQL_LOG
: > "$PSQL_LOG"
PSQL_EXIT=1 apply_seed >/dev/null 2>&1
check "propagates a psql failure" 1 $?

# ── A missing seed file is a repo problem, and must be loud ─────────────────
mv "$SEED_PATH" "$SEED_PATH.bak"
PSQL_LOG="$STUB_DIR/log3"; export PSQL_LOG
: > "$PSQL_LOG"
output="$(PSQL_EXIT=0 apply_seed 2>&1)"; rc=$?
check "fails when the seed file is missing" 1 $rc
check_contains "names the missing file" "$output" "seed-qa.sql"
if [ ! -s "$PSQL_LOG" ]; then
  pass=$((pass + 1)); echo "  ok   does not call psql when the seed is missing"
else
  fail=$((fail + 1)); echo "  FAIL should not have called psql"
fi
mv "$SEED_PATH.bak" "$SEED_PATH"

# ── The password comes from the env file, never a hardcoded default ─────────
PSQL_LOG="$STUB_DIR/log4"; export PSQL_LOG
: > "$PSQL_LOG"
printf 'POSTGRES_PASSWORD=\n' > "$QA_ENV_FILE"
output="$(PSQL_EXIT=0 apply_seed 2>&1)"; rc=$?
check "fails when POSTGRES_PASSWORD is absent" 1 $rc
check_contains "names the missing setting" "$output" "POSTGRES_PASSWORD"
printf 'POSTGRES_PASSWORD=s3cret\n' > "$QA_ENV_FILE"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
