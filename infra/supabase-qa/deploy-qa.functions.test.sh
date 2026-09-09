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
  extract restart_auth
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
echo "restart_auth()"

# spec-88 fase 3, ronda 4 — the exact bug this file already exists to catch
# (see the header above), reproduced for `auth`: GOTRUE_HOOK_CUSTOM_ACCESS_
# TOKEN_ENABLED was added to docker-compose.yml (20260922000001's companion
# infra change) and nothing recreated the `auth` container to pick it up.
# `restart_functions()` above got tested when BEETRACK_WEBHOOK_SECRET hit
# the same trap; this is that same regression net for `auth`.
DOCKER_LOG="$STUB_DIR/docker2"; export DOCKER_LOG
: > "$DOCKER_LOG"
restart_auth >/dev/null 2>&1
invocation="$(cat "$DOCKER_LOG")"

check_contains "recreates the container so compose changes apply" "$invocation" "up -d"
check_not_contains "does not use a plain restart" "$invocation" "compose -f .* restart auth"
check_contains "targets the auth service" "$invocation" "auth"
check_contains "passes the QA env file" "$invocation" "$QA_ENV_FILE"
# ronda 4's --no-deps fix: without it, `up -d auth` also recreates `db`
# (QA's Postgres, carrying Musan) whenever ITS config-hash changed — a
# multi-second connection cut as a side effect of an unrelated `auth:`-only
# compose edit. See the comment on restart_auth() in deploy-qa.sh.
check_contains "does not also touch db as a side effect" "$invocation" "--no-deps"

echo ""
echo "widen_changed_flags() — QA compose (spec-88 fase 3, ronda 4)"

# The whole point of a SEPARATE flag from CHANGED_EDGE_FUNCTIONS: a
# functions/-only change must NOT recreate `auth` (that would be needless
# GoTrue downtime on every unrelated edge-function edit), and a
# compose-only change must NOT skip recreating `auth` just because
# CHANGED_EDGE_FUNCTIONS already covers `functions`.
FAKE_DIFF='infra/supabase-qa/docker-compose.yml'; export FAKE_DIFF
CHANGED_QA_COMPOSE=false
widen_changed_flags >/dev/null 2>&1
check_eq "a compose change recreates auth too" "true" "$CHANGED_QA_COMPOSE"

FAKE_DIFF='packages/database/supabase/functions/beetrack-webhook/index.ts'; export FAKE_DIFF
CHANGED_QA_COMPOSE=false
widen_changed_flags >/dev/null 2>&1
check_eq "a functions-only change does NOT recreate auth" "false" "$CHANGED_QA_COMPOSE"

FAKE_DIFF='docs/qa-environment.md'; export FAKE_DIFF
CHANGED_QA_COMPOSE=false
widen_changed_flags >/dev/null 2>&1
check_eq "an unrelated change leaves it alone" "false" "$CHANGED_QA_COMPOSE"

echo ""
echo "container_health_check() (spec-88 fase 3, ronda 4)"

# post_checks() had no assertion at all on the `auth` (GoTrue) container.
# `up -d auth` only waits for ITS dependencies to be healthy, not for `auth`
# itself — and a bad hook config kills GoTrue on startup, confirmed in this
# round's review. Without this check, that scenario is a green deploy and
# the failure only surfaces ~15 minutes later in e2e-qa as an opaque
# waitForURL timeout with nothing pointing at GoTrue.
{
  echo "CHECKS=()"
  echo "RESULT=0"
  extract record
  extract container_health_check
} > "$STUB_DIR/health-fns.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/health-fns.sh"

# A `docker inspect` stub whose answer is controlled by FAKE_HEALTH.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "inspect" ]; then
  if [ -z "${FAKE_HEALTH:-}" ]; then
    exit 1  # container not found — `docker inspect` exits non-zero
  fi
  printf '%s' "$FAKE_HEALTH"
  exit 0
fi
exit 0
STUB
chmod +x "$STUB_DIR/docker"

CHECKS=(); RESULT=0
FAKE_HEALTH="healthy" container_health_check "auth (GoTrue)" supabase-qa-auth
check_eq "healthy container passes" "auth (GoTrue)|ok|healthy" "${CHECKS[0]}"
check_eq "healthy container does not fail the deploy" "0" "$RESULT"

CHECKS=(); RESULT=0
FAKE_HEALTH="unhealthy" container_health_check "auth (GoTrue)" supabase-qa-auth
check_eq "unhealthy container fails the check" "auth (GoTrue)|FAIL|unhealthy" "${CHECKS[0]}"
check_eq "unhealthy container fails the deploy" "1" "$RESULT"

CHECKS=(); RESULT=0
FAKE_HEALTH="starting" container_health_check "auth (GoTrue)" supabase-qa-auth
check_eq "still-starting container fails the check (not just 'healthy' passes)" "auth (GoTrue)|FAIL|starting" "${CHECKS[0]}"

CHECKS=(); RESULT=0
FAKE_HEALTH="" container_health_check "auth (GoTrue)" supabase-qa-auth
check_eq "missing container fails, not silently passes" "auth (GoTrue)|FAIL|not found" "${CHECKS[0]}"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
