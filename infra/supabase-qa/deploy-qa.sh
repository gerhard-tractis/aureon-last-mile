#!/usr/bin/env bash
# deploy-qa.sh — keeps the VPS QA environment in sync on every green main merge
# (spec-48). Invoked by the deploy-qa job in .github/workflows/deploy.yml on the
# self-hosted VPS runner.
#
# Inputs (environment variables, set by the workflow):
#   DEPLOY_SHA               the commit whose CI went green (required). QA is
#                            synced to main's TIP, which is normally the same
#                            commit — see sync_checkout for why it is the tip
#                            and not this, and what breaks when it is not.
#   GITHUB_TOKEN             token for the authenticated fetch (required)
#   GITHUB_REPOSITORY        owner/repo (provided by the Actions runner)
#   CHANGED_FRONTEND         true/false — apps/frontend touched
#   CHANGED_WORKER           true/false — apps/worker touched
#   CHANGED_AGENTS           true/false — apps/agents touched
#   CHANGED_EDGE_FUNCTIONS   true/false — supabase functions touched
#
# Behavior:
#   - If the QA environment is not provisioned (checkout or env file missing),
#     exits 0 with a message — QA is optional, prod deploys must not break.
#   - Migrations AND seed-qa.sql are applied on EVERY run (both idempotent) —
#     this is the QA-drift backstop; app rebuilds/restarts happen only for the
#     CHANGED_* flags.
#   - Those flags are then widened against what QA actually had checked out, so
#     a QA sync that GitHub dropped cannot leave an app un-rebuilt forever
#     (widen_changed_flags).
#
# Test-only overrides (never set these on the VPS):
#   QA_CHECKOUT_DIR=<path>   QA checkout location (default /home/aureon/aureon-qa)
#   QA_ENV_FILE=<path>       QA env file (default /home/aureon/.env.qa)
# The script can also be `source`d: functions are defined but nothing runs.

set -euo pipefail

QA_CHECKOUT_DIR="${QA_CHECKOUT_DIR:-/home/aureon/aureon-qa}"
QA_ENV_FILE="${QA_ENV_FILE:-/home/aureon/.env.qa}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
err() { log "ERROR: $*" >&2; }
env_get() { { grep -E "^${1}=" "$QA_ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'; }
is_true() { [ "${1:-false}" = "true" ]; }

# --------------------------------------------------------------------------
# Guards
# --------------------------------------------------------------------------
guard_provisioned() { # exit 0 (skip) when QA is not set up on this host
  if [ ! -d "$QA_CHECKOUT_DIR" ] || [ ! -f "$QA_ENV_FILE" ]; then
    log "QA environment not provisioned — skipping"
    exit 0
  fi
}

guard_env_file() { # QA must never point at the production cloud project
  # Scan values only — comment lines legitimately mention supabase.co (the template's own warning).
  if grep -qE '^[^#]*supabase\.co' "$QA_ENV_FILE"; then
    err "env file $QA_ENV_FILE mentions supabase.co — QA must NEVER point at the production cloud project. ABORTING."
    exit 1
  fi
}

guard_inputs() {
  [ -n "${DEPLOY_SHA:-}" ] || { err "DEPLOY_SHA is not set"; exit 1; }
  [ -n "${GITHUB_TOKEN:-}" ] || { err "GITHUB_TOKEN is not set"; exit 1; }
  [ -n "${GITHUB_REPOSITORY:-}" ] || { err "GITHUB_REPOSITORY is not set"; exit 1; }
}

# --------------------------------------------------------------------------
# Sync the QA checkout to main's tip (token-scrub pattern: never leave the
# token sitting in .git/config — same as the prod worker/agents jobs).
#
# main's TIP, not DEPLOY_SHA. Every Deploy Production run contends for the
# `qa-deploy` concurrency group, and GitHub keeps only one PENDING run per
# group: when a third merge queues, the one already waiting is cancelled. On
# 2026-08-17 #441, #438 and #442 merged inside three minutes, #438's QA sync
# was evicted, and the run that did land was #442 — an EARLIER commit. QA was
# reset backwards and served pre-#438 code with every check green.
#
# Syncing to the tip makes a dropped run self-healing: whichever run survives
# brings QA to whatever main has, so no merge can be skipped, only coalesced.
# QA_PREV_SHA is recorded first so widen_changed_flags can tell what QA missed.
# --------------------------------------------------------------------------
sync_checkout() {
  cd "$QA_CHECKOUT_DIR"
  QA_PREV_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  # Scrub the token from .git/config even if fetch/reset fails mid-way.
  trap 'git -C "$QA_CHECKOUT_DIR" remote set-url origin "https://github.com/${GITHUB_REPOSITORY}.git"' EXIT
  git fetch origin main
  QA_SYNCED_SHA="$(git rev-parse FETCH_HEAD)"
  if [ "$QA_SYNCED_SHA" != "${DEPLOY_SHA}" ]; then
    log "note: main has moved to ${QA_SYNCED_SHA} since ${DEPLOY_SHA} was tested — syncing QA to the tip"
  fi
  log "syncing ${QA_CHECKOUT_DIR} to ${QA_SYNCED_SHA}"
  git reset --hard "$QA_SYNCED_SHA"
  git remote set-url origin "https://github.com/${GITHUB_REPOSITORY}.git"
  trap - EXIT
}

# --------------------------------------------------------------------------
# Widen the CHANGED_* flags to cover everything QA has not seen yet.
#
# The flags arrive from the workflow's `changes` job, which diffs exactly one
# commit — DEPLOY_SHA against its parent. That is only correct if every merge's
# QA sync actually runs. When one is evicted (see sync_checkout), its files are
# in no other run's diff, so nothing rebuilds them and QA keeps serving the old
# bundle. That is exactly how #438's landing-page removal never reached QA.
#
# Migrations and the seed already defend against this by replaying in full
# every run. This is the same backstop for app rebuilds: diff from what QA
# actually has to what it is being moved to, and OR the result into the flags.
# Widen only — the workflow's own answer is authoritative for its commit, and
# turning a true into a false would skip a rebuild that is genuinely needed.
# --------------------------------------------------------------------------
widen_changed_flags() {
  local prev="${QA_PREV_SHA:-}"
  local target="${QA_SYNCED_SHA:-${DEPLOY_SHA:-}}"
  local changed

  if [ -z "$prev" ] || ! git -C "$QA_CHECKOUT_DIR" rev-parse -q --verify "${prev}^{commit}" >/dev/null 2>&1; then
    # A fresh checkout, or one whose old commit is gone. Assuming "nothing
    # changed" is how QA stays stale; rebuilding everything is merely slow.
    log "QA has no usable previous commit — rebuilding every app"
    CHANGED_FRONTEND=true
    CHANGED_WORKER=true
    CHANGED_AGENTS=true
    CHANGED_EDGE_FUNCTIONS=true
    return 0
  fi

  [ "$prev" != "$target" ] || return 0

  changed="$(git -C "$QA_CHECKOUT_DIR" diff --name-only "$prev" "$target" 2>/dev/null || true)"
  [ -n "$changed" ] || return 0

  widen() { # $1 current flag, $2 path regex
    if [ "$1" = true ]; then echo true
    elif printf '%s\n' "$changed" | grep -qE "$2"; then echo true
    else echo false
    fi
  }

  CHANGED_FRONTEND="$(widen "${CHANGED_FRONTEND:-false}" '^apps/frontend/')"
  CHANGED_WORKER="$(widen "${CHANGED_WORKER:-false}" '^apps/worker/')"
  CHANGED_AGENTS="$(widen "${CHANGED_AGENTS:-false}" '^apps/agents/')"
  CHANGED_EDGE_FUNCTIONS="$(widen "${CHANGED_EDGE_FUNCTIONS:-false}" '^packages/database/supabase/functions/')"

  log "QA was at ${prev} — flags now frontend=${CHANGED_FRONTEND} worker=${CHANGED_WORKER} agents=${CHANGED_AGENTS} edge=${CHANGED_EDGE_FUNCTIONS}"
}

# --------------------------------------------------------------------------
# Migrations — ALWAYS applied (idempotent). This is the drift backstop: the
# prod DB job is path-filtered, but QA replays the full migration ledger on
# every green merge so QA can never silently fall behind the schema.
# --------------------------------------------------------------------------
apply_migrations() {
  local pw; pw="$(env_get POSTGRES_PASSWORD)"
  [ -n "$pw" ] || { err "POSTGRES_PASSWORD missing in $QA_ENV_FILE"; exit 1; }
  log "applying migrations (localhost:5433)"
  "${QA_CHECKOUT_DIR}/infra/supabase-qa/apply-migrations.sh" \
    --db-url "postgresql://postgres:${pw}@localhost:5433/postgres"
}

# --------------------------------------------------------------------------
# Seed — ALSO applied on every run, for the same reason as migrations.
#
# seed-qa.sql is idempotent by construction (every INSERT is ON CONFLICT DO
# NOTHING on a fixed id, and nothing in it deletes or truncates), so replaying
# it converges QA to the seed baseline without touching rows QA already has.
#
# It used to run only from setup-qa.sh, the one-time bootstrap. That meant any
# seed row added after provisioning never reached QA: the dock zones added for
# spec-54 left Distribución showing "Sin andenes configurados" until someone
# SSHed in. Seeding here removes the manual step.
#
# create-qa-users.sh deliberately stays in setup-qa.sh — it calls the GoTrue
# admin API, the users already exist, and it is not needed to correct drift.
# --------------------------------------------------------------------------
apply_seed() {
  local pw; pw="$(env_get POSTGRES_PASSWORD)"
  [ -n "$pw" ] || { err "POSTGRES_PASSWORD missing in $QA_ENV_FILE"; return 1; }
  local seed="${QA_CHECKOUT_DIR}/packages/database/supabase/seed-qa.sql"
  [ -f "$seed" ] || { err "seed file not found: $seed"; return 1; }
  log "applying seed-qa.sql (localhost:5433)"
  # ON_ERROR_STOP=1: without it psql skips failed statements and still exits 0,
  # which would report a half-applied seed as a healthy deploy.
  PGPASSWORD="$pw" psql -h localhost -p 5433 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -q -f "$seed"
}

# --------------------------------------------------------------------------
# App rebuilds (path-filtered). npm ci runs at most once per deploy.
# --------------------------------------------------------------------------
NPM_CI_DONE=0
npm_ci_once() {
  [ "$NPM_CI_DONE" -eq 1 ] && return 0
  log "npm ci at monorepo root (${QA_CHECKOUT_DIR})"
  (cd "$QA_CHECKOUT_DIR" && npm ci)
  NPM_CI_DONE=1
}

restart_functions() {
  # Rebuild the merged host dir the compose file mounts (repo functions +
  # vendored main router — see setup-qa.sh merge_functions_dir), then restart.
  local merge_dir="${QA_FUNCTIONS_MERGE_DIR:-/home/aureon/supabase-qa-functions}"
  local infra_dir="${QA_CHECKOUT_DIR}/infra/supabase-qa"
  log "refreshing merged edge-functions dir at ${merge_dir}"
  mkdir -p "$merge_dir"
  rm -rf "${merge_dir:?}"/*
  cp -a "${QA_CHECKOUT_DIR}/packages/database/supabase/functions/." "$merge_dir/"
  cp -a "${infra_dir}/volumes/functions/main" "$merge_dir/"
  log "restarting edge functions container"
  docker compose -f "${infra_dir}/docker-compose.yml" \
    --env-file "$QA_ENV_FILE" restart functions
}

# Restarting the QA units needs passwordless sudo. The prod units have a
# sudoers rule (apps/worker/scripts/deploy.sh relies on the same thing); the QA
# units were never added to it, so the job used to build for five minutes and
# then die on "sudo: a password is required" with no indication of the fix.
#
# Check up front, once, for every unit this run will actually restart.
guard_sudo() {
  local missing=()
  local unit

  # Already root (some runner configurations): nothing to check.
  if [ "$(id -u)" -eq 0 ]; then return 0; fi

  for unit in "$@"; do
    # `sudo -l <command>` asks whether this exact command is permitted, without
    # running it. Testing anything else would be wrong: a sudoers rule scoped to
    # `systemctl restart <unit>` does not permit `systemctl is-active <unit>`,
    # so probing with a different verb reports a failure that isn't real.
    if ! sudo -n -l systemctl restart "$unit" >/dev/null 2>&1; then
      missing+=("$unit")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "::error::QA deploy cannot restart the QA systemd units — passwordless sudo is unavailable for: ${missing[*]}"
    echo "Fix on the VPS (see docs/qa-environment.md):" >&2
    echo "  sudo visudo -f /etc/sudoers.d/aureon-qa" >&2
    echo "  aureon ALL=(root) NOPASSWD: /bin/systemctl restart aureon-frontend-qa, \\" >&2
    echo "                              /bin/systemctl restart aureon-agents-qa, \\" >&2
    echo "                              /bin/systemctl restart aureon-worker-qa" >&2
    echo "Confirm the runner user and 'which systemctl' first, and match the existing prod rule." >&2
    return 1
  fi
}

deploy_frontend() {
  npm_ci_once
  # NEXT_PUBLIC_* vars are baked in at build time -> env sourced in a subshell
  # only, so it does not leak into the other builds (same as setup-qa.sh).
  log "building frontend (@aureon/frontend) with QA env"
  # shellcheck disable=SC1090  # env file path is runtime-configurable
  (set -a; . "$QA_ENV_FILE"; set +a; cd "$QA_CHECKOUT_DIR" && npm run build --workspace=@aureon/frontend)
  log "restarting aureon-frontend-qa"
  sudo systemctl restart aureon-frontend-qa
}

deploy_node_app() { # $1 = workspace suffix (agents|worker)
  npm_ci_once
  log "building @aureon/$1"
  (cd "$QA_CHECKOUT_DIR" && npm run build --workspace="@aureon/$1")
  log "restarting aureon-$1-qa"
  sudo systemctl restart "aureon-$1-qa"
}

# --------------------------------------------------------------------------
# Post-checks — always verify kong + db reachability; per-app checks only for
# what was touched. curl patterns mirror setup-qa.sh.
# --------------------------------------------------------------------------
CHECKS=()
RESULT=0
record() { CHECKS+=("$1|$2|$3"); [ "$2" = "ok" ] || RESULT=1; }

http_check() { # $1 name, $2 url, $3 mode: any (any HTTP response) | success (2xx/3xx)
  local code
  code="$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$2" || true)"
  case "$3" in
    any)     if [ "$code" != "000" ]; then record "$1" ok "HTTP $code"; else record "$1" FAIL "no HTTP response"; fi ;;
    success) case "$code" in 2*|3*) record "$1" ok "HTTP $code" ;; *) record "$1" FAIL "HTTP $code" ;; esac ;;
  esac
}

unit_check() { # $1 systemd unit
  local state; state="$(systemctl is-active "$1" 2>/dev/null || true)"
  if [ "$state" = "active" ]; then record "unit $1" ok active; else record "unit $1" FAIL "${state:-unknown}"; fi
}

db_check() {
  local pw; pw="$(env_get POSTGRES_PASSWORD)"
  if PGPASSWORD="$pw" psql -h localhost -p 5433 -U postgres -d postgres -qAtX -c 'SELECT 1' >/dev/null 2>&1; then
    record "db (5433)" ok "SELECT 1"
  else
    record "db (5433)" FAIL "not reachable"
  fi
}

post_checks() {
  log "post-checks (giving restarted services a few seconds to boot)"
  sleep 5
  http_check "kong (8100)" "http://localhost:8100/" any
  db_check
  if is_true "${CHANGED_FRONTEND:-}"; then
    http_check "frontend (3200)" "http://localhost:3200/" success
    unit_check aureon-frontend-qa
  fi
  if is_true "${CHANGED_AGENTS:-}"; then
    http_check "agents health (3210)" "http://localhost:3210/health" success
    unit_check aureon-agents-qa
  fi
  if is_true "${CHANGED_WORKER:-}"; then
    unit_check aureon-worker-qa
  fi

  local c n s d
  printf ' %-28s %-6s %s\n' "CHECK" "STATUS" "DETAIL"
  for c in "${CHECKS[@]}"; do
    IFS='|' read -r n s d <<< "$c"
    printf ' %-28s %-6s %s\n' "$n" "$s" "$d"
  done
  if [ "$RESULT" -ne 0 ]; then
    err "one or more QA post-checks FAILED — inspect: journalctl -u <unit> -n 50 / docker compose logs"
    exit 1
  fi
  log "QA in sync at ${QA_SYNCED_SHA:-${DEPLOY_SHA}}"
}

# --------------------------------------------------------------------------
main() {
  guard_provisioned
  guard_env_file
  guard_inputs
  sync_checkout
  # Must follow sync_checkout: it needs QA_PREV_SHA and QA_SYNCED_SHA, and it
  # decides which units the sudo guard below has to cover.
  widen_changed_flags

  # Fail before the expensive builds if we cannot restart what we are about to
  # rebuild. Migrations still run below either way — schema parity is the
  # drift backstop and needs no sudo.
  # Plain `cond && arr+=(x)` would abort the script under `set -e` whenever the
  # flag is false, so each of these stays an explicit if.
  units_to_restart=()
  if is_true "${CHANGED_FRONTEND:-}"; then units_to_restart+=(aureon-frontend-qa); fi
  if is_true "${CHANGED_AGENTS:-}";   then units_to_restart+=(aureon-agents-qa);   fi
  if is_true "${CHANGED_WORKER:-}";   then units_to_restart+=(aureon-worker-qa);   fi
  if [ ${#units_to_restart[@]} -gt 0 ]; then
    guard_sudo "${units_to_restart[@]}"
  fi

  apply_migrations
  apply_seed
  if is_true "${CHANGED_EDGE_FUNCTIONS:-}"; then restart_functions; fi
  if is_true "${CHANGED_FRONTEND:-}"; then deploy_frontend; fi
  if is_true "${CHANGED_AGENTS:-}"; then deploy_node_app agents; fi
  if is_true "${CHANGED_WORKER:-}"; then deploy_node_app worker; fi
  post_checks
}

# Run only when executed, not when sourced (lets tests source the functions).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
