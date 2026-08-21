#!/usr/bin/env bash
#
# Tests for restart_functions() and the edge-function change flag in
# deploy-qa.sh.
#
# BEETRACK_WEBHOOK_SECRET was added to the edge-runtime service's environment
# and never reached the container. Two reasons, both here:
#
#   1. `docker compose restart` reuses the existing container's config, so a
#      new environment entry is not applied. Only a recreate (`up -d`) reads
#      the compose file again.
#   2. The edge flag widens on packages/database/supabase/functions/ alone, so
#      editing the compose file did not even trigger the restart.
#
# The endpoint kept answering 500 "Server misconfigured" through a green
# deploy, and the container had to be recreated by hand. These tests stub
# `docker` so the behaviour is verifiable without a VPS.
#
# Run: bash infra/supabase-qa/deploy-qa.functions.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

pass=0
fail=0

check_contains() { # $1 name, $2 haystack, $3 needle
  if printf '%s' "$2" | grep -q -- "$3"; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected to find '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  fi
}

check_not_contains() { # $1 name, $2 haystack, $3 needle
  if printf '%s' "$2" | grep -q -- "$3"; then
    fail=$((fail + 1)); echo "  FAIL $1 — did not expect '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  else
    pass=$((pass + 1)); echo "  ok   $1"
  fi
}

check_eq() { # $1 name, $2 expected, $3 actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected '$2', got '$3'"
  fi
}

# A `docker` stub that records its argv.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/docker"
export PATH="$STUB_DIR:$PATH"

# A fake QA checkout with the two directories restart_functions copies from.
FAKE_QA="$STUB_DIR/qa"
mkdir -p "$FAKE_QA/packages/database/supabase/functions/beetrack-webhook"
mkdir -p "$FAKE_QA/infra/supabase-qa/volumes/functions/main"
echo "// fn" > "$FAKE_QA/packages/database/supabase/functions/beetrack-webhook/index.ts"
echo "// main" > "$FAKE_QA/infra/supabase-qa/volumes/functions/main/index.ts"
echo "services:" > "$FAKE_QA/infra/supabase-qa/docker-compose.yml"

export QA_CHECKOUT_DIR="$FAKE_QA"
export QA_ENV_FILE="$STUB_DIR/.env.qa"
export QA_FUNCTIONS_MERGE_DIR="$STUB_DIR/merged"
printf 'POSTGRES_PASSWORD=s3cret\n' > "$QA_ENV_FILE"

extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
{
  echo "QA_CHECKOUT_DIR=\"$FAKE_QA\""
  echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
  extract log
  extract err
  extract restart_functions
  extract widen_changed_flags
} > "$STUB_DIR/fns.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/fns.sh"

echo "restart_functions()"

DOCKER_LOG="$STUB_DIR/docker1"; export DOCKER_LOG
: > "$DOCKER_LOG"
restart_functions >/dev/null 2>&1
invocation="$(cat "$DOCKER_LOG")"

# The whole point: a plain restart cannot pick up a changed environment entry.
check_contains "recreates the container so compose changes apply" "$invocation" "up -d"
check_not_contains "does not use a plain restart" "$invocation" "compose -f .* restart functions"
check_contains "targets the functions service" "$invocation" "functions"
check_contains "passes the QA env file" "$invocation" "$QA_ENV_FILE"

echo ""
echo "widen_changed_flags() — edge functions"

# A git stub standing in for the checkout's history: rev-parse succeeds, and
# diff prints whatever the test put in FAKE_DIFF.
cat > "$STUB_DIR/git" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = "rev-parse" ]; then exit 0; fi
  if [ "$arg" = "diff" ]; then printf '%s\n' "$FAKE_DIFF"; exit 0; fi
done
exit 0
STUB
chmod +x "$STUB_DIR/git"

export QA_PREV_SHA=aaaaaaa
export QA_SYNCED_SHA=bbbbbbb

FAKE_DIFF='infra/supabase-qa/docker-compose.yml' \
  CHANGED_EDGE_FUNCTIONS=false widen_changed_flags >/dev/null 2>&1
# The flag is set inside the function; re-run capturing it in this shell.
FAKE_DIFF='infra/supabase-qa/docker-compose.yml'; export FAKE_DIFF
CHANGED_EDGE_FUNCTIONS=false
widen_changed_flags >/dev/null 2>&1
check_eq "a compose change rebuilds the edge runtime" "true" "$CHANGED_EDGE_FUNCTIONS"

FAKE_DIFF='packages/database/supabase/functions/beetrack-webhook/index.ts'; export FAKE_DIFF
CHANGED_EDGE_FUNCTIONS=false
widen_changed_flags >/dev/null 2>&1
check_eq "a function change still rebuilds the edge runtime" "true" "$CHANGED_EDGE_FUNCTIONS"

FAKE_DIFF='docs/qa-environment.md'; export FAKE_DIFF
CHANGED_EDGE_FUNCTIONS=false
widen_changed_flags >/dev/null 2>&1
check_eq "an unrelated change leaves it alone" "false" "$CHANGED_EDGE_FUNCTIONS"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
