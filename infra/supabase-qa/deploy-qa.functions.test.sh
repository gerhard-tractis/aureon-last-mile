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

# grep via a here-string, NOT `printf | grep -q`. With `set -o pipefail` (set
# at the top of this file) that pipeline is a coin flip on a large haystack:
# `grep -q` exits the instant it matches, printf then dies of SIGPIPE (141),
# and pipefail hands the pipeline printf's status — so a MATCHING assertion
# reports FAIL. check_not_contains had the mirror bug: the same SIGPIPE turned
# a real match into a silent pass. Both were observed flapping between runs on
# the VPS once this file grew. A here-string has no second process.
check_contains() { # $1 name, $2 haystack, $3 needle
  if grep -q -- "$3" <<< "$2"; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected to find '$3' in:"
    printf '%s\n' "$2" | sed 's/^/         /'
  fi
}

check_not_contains() { # $1 name, $2 haystack, $3 needle
  if grep -q -- "$3" <<< "$2"; then
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
echo "clear_merge_dir() — the wipe that took QA down (run 34388997942)"

# restart_functions() used to wipe the merge dir with `rm -rf "$merge_dir"/*`.
# Under `set -euo pipefail` that line killed the entire QA sync on 2026-09-09:
# the dir held files owned by uid 197609 (a manual scp that preserved numeric
# ids, 2026-08-21), and the runner user `aureon` owns only the PARENT — so rm
# could unlink the directory entry but not the files inside it. "Permission
# denied", exit 1, QA drifted, production deploy blocked.
#
# It also silently skipped dotfiles, so a stale `.something` survived every
# wipe. Clearing must either succeed completely, or say which entries survived
# and how to fix them.

{ echo "$(extract clear_merge_dir)"; } > "$STUB_DIR/clear-fns.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/clear-fns.sh"

# (1) an empty dir must stay a no-op (rm -f tolerated the unexpanded glob;
# find must not regress that)
EMPTY_DIR="$STUB_DIR/empty-merge"
mkdir -p "$EMPTY_DIR"
out="$(clear_merge_dir "$EMPTY_DIR" 2>&1)"; rc=$?
check_eq "an already-empty merge dir clears cleanly" "0" "$rc"

# (2) stale entries from a previous deploy are actually gone, dotfiles too
STALE_DIR="$STUB_DIR/stale-merge"
mkdir -p "$STALE_DIR/deleted-function"
echo "// removed from the repo" > "$STALE_DIR/deleted-function/index.ts"
echo "stale" > "$STALE_DIR/.hidden"
clear_merge_dir "$STALE_DIR" >/dev/null 2>&1
check_eq "a function deleted from the repo is wiped" "" "$(ls -A "$STALE_DIR")"

# (3) an entry we cannot remove fails LOUDLY and actionably, naming the path
# and the remediation — not a bare exit 1 with the reason buried in a
# separately-buffered stream.
DENIED_DIR="$STUB_DIR/denied-merge"
mkdir -p "$DENIED_DIR/ghost"
echo "// cannot be deleted" > "$DENIED_DIR/ghost/index.ts"
chmod a-w "$DENIED_DIR/ghost" 2>/dev/null || true
# Whether an unwritable directory actually blocks a delete is a property of
# the user AND the filesystem, not of the uid: root ignores the mode bits, and
# so do the Windows/Git-Bash and container-mount filesystems some of us run
# these tests on. Probe it instead of guessing from `id -u` — a guess that
# skips nothing on Windows and then fails the assertion for the wrong reason.
if rm -f "$DENIED_DIR/ghost/index.ts" 2>/dev/null; then
  echo "  skip unremovable-entry case (this user/filesystem does not enforce the mode bits)"
  chmod u+w "$DENIED_DIR/ghost" 2>/dev/null || true
else
  out="$(clear_merge_dir "$DENIED_DIR" 2>&1)"; rc=$?
  chmod u+w "$DENIED_DIR/ghost" 2>/dev/null || true  # let the EXIT trap clean up
  check_eq "an unremovable entry fails the function" "1" "$rc"
  check_contains "the error names the surviving path" "$out" "ghost/index.ts"
  # The message must SHOW the reason, not infer it from ownership: the first
  # draft of this guard blamed the uid for a failure that was really find
  # being unable to read its starting directory.
  check_contains "the error quotes what the wipe itself reported" "$out" "Permission denied"
  check_contains "the error names the owning uid" "$out" "uid"
  check_contains "the error gives the exact remediation" "$out" "chown -R"
fi

echo ""
echo "on_err() — an exit 1 must never be mute"

# Run 34388997942 read as a silent failure: the last line in the log was
# "refreshing merged edge-functions dir", then `##[error]Process completed
# with exit code 1` with no reason. The reason WAS emitted — `rm: cannot
# remove ...: Permission denied` — but it landed ~40 lines earlier, spliced
# into the middle of create-qa-users.sh's output, because this script's own
# stdout is block-buffered through the runner's pipe while a child's stderr
# is not. Whoever reads the tail of a failing job sees nothing.
#
# on_err() closes that hole from the other end: whatever fails, and wherever
# its raw stderr lands, the run gets an ::error:: annotation naming the line,
# the exit code and the command.
{ echo "$(extract on_err)"; } > "$STUB_DIR/err-fns.sh"
# shellcheck disable=SC1091
. "$STUB_DIR/err-fns.sh"

out="$( (exit 7); on_err 261 'rm -rf "${merge_dir:?}"/*' 2>&1 )"
check_contains "annotates the run so it shows outside the raw log" "$out" "::error::"
check_contains "reports the failing line number" "$out" "261"
check_contains "reports the exit code" "$out" "7"
check_contains "reports the failing command" "$out" "rm -rf"
check_contains "says plainly that QA is not in sync" "$out" "NOT in sync"

echo ""
echo "wiring (spec-88 fase 3, ronda 5)"

# Every test above proves the FUNCTIONS are correct in isolation — none of
# them call main() or post_checks(), so none would notice if the CALL SITE
# were ever deleted. That is exactly the bug this whole phase chased for
# four rounds: restart_functions() was correct from the start; what was
# missing was the caller for `auth`. Grep the actual wiring, the same way a
# `git blame`/review would, so removing either line goes red here instead
# of silently in production.
deploy_qa_src="$(cat "$HERE/deploy-qa.sh")"
check_contains "main() calls restart_auth when the compose changed" "$deploy_qa_src" 'CHANGED_QA_COMPOSE:-}"; then restart_auth'
check_contains "post_checks() checks the auth container" "$deploy_qa_src" 'container_health_check "auth (GoTrue)"'
check_contains "post_checks() checks the edge functions container" "$deploy_qa_src" 'container_health_check "edge functions"'

# The trap is only useful if it is actually installed, and it only fires
# inside functions when errtrace (set -E) is on — `set -euo pipefail` alone
# would let restart_functions() die without ever reaching on_err.
check_contains "the script enables errtrace so the ERR trap fires in functions" "$deploy_qa_src" 'set -Eeuo pipefail'
check_contains "main() installs the ERR trap" "$deploy_qa_src" "trap 'on_err"
check_contains "restart_functions() delegates the wipe to clear_merge_dir" "$deploy_qa_src" 'clear_merge_dir "$merge_dir"'
check_not_contains "the raw rm -rf glob is gone" "$deploy_qa_src" 'rm -rf "${merge_dir:?}"/\*'
check_contains "stdout is line-buffered so log order survives the runner's pipes" "$deploy_qa_src" 'stdbuf -oL'


echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
