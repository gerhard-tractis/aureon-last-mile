#!/usr/bin/env bash
# deploy-qa.sh — keeps the VPS QA environment in sync on every green main merge
# (spec-48). Invoked by the deploy-qa job in .github/workflows/deploy.yml on the
# self-hosted VPS runner.
#
# Inputs (environment variables, set by the workflow):
#   DEPLOY_SHA               commit to sync the QA checkout to (required)
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
#   - Migrations are applied on EVERY run (idempotent) — this is the QA-drift
#     backstop; app rebuilds/restarts happen only for the CHANGED_* flags.
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
  if grep -q 'supabase\.co' "$QA_ENV_FILE"; then
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
# Sync the QA checkout to the tested commit (token-scrub pattern: never leave
# the token sitting in .git/config — same as the prod worker/agents jobs).
# --------------------------------------------------------------------------
sync_checkout() {
  log "syncing ${QA_CHECKOUT_DIR} to ${DEPLOY_SHA}"
  cd "$QA_CHECKOUT_DIR"
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  # Scrub the token from .git/config even if fetch/reset fails mid-way.
  trap 'git -C "$QA_CHECKOUT_DIR" remote set-url origin "https://github.com/${GITHUB_REPOSITORY}.git"' EXIT
  git fetch origin main
  git reset --hard "$DEPLOY_SHA"
  git remote set-url origin "https://github.com/${GITHUB_REPOSITORY}.git"
  trap - EXIT
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
  log "restarting edge functions container"
  docker compose -f "${QA_CHECKOUT_DIR}/infra/supabase-qa/docker-compose.yml" \
    --env-file "$QA_ENV_FILE" restart functions
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
  log "QA in sync at ${DEPLOY_SHA}"
}

# --------------------------------------------------------------------------
main() {
  guard_provisioned
  guard_env_file
  guard_inputs
  sync_checkout
  apply_migrations
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
