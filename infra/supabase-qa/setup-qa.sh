#!/usr/bin/env bash
# setup-qa.sh — one-shot QA environment orchestrator for the Aureon VPS (spec-48).
#
# Assumes (does NOT do either of these itself):
#   - repo already cloned at /home/aureon/aureon-qa
#   - /home/aureon/.env.qa already generated (generate-qa-secrets.sh) and filled
#
# Steps: preflight -> docker stack up + health wait -> migrations -> seed +
# QA users -> npm ci + builds -> install/start systemd units -> post-checks.
#
# Idempotent: safe to re-run. Ports held by our own compose stack / QA units
# are not treated as conflicts; migrations/seed/users are idempotent already.
#
# Usage: ./setup-qa.sh
#
# Test-only overrides (never set these on the VPS):
#   QA_ENV_FILE=<path>          use a different env file (preflight tests)
#   QA_SETUP_SKIP_OS_CHECK=1    skip the Linux uname check so the preflight
#                               logic can be exercised on dev machines
# The script can also be `source`d: functions are defined but nothing runs,
# so tests can call preflight/env_get/etc. directly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${QA_ENV_FILE:-/home/aureon/.env.qa}"
QA_ROOT="/home/aureon/aureon-qa"
SEED_SQL="${SCRIPT_DIR}/../../packages/database/supabase/seed-qa.sql"
QA_UNITS=(aureon-frontend-qa aureon-agents-qa aureon-worker-qa)
STACK_TIMEOUT=300
COMPOSE=(docker compose -f "${SCRIPT_DIR}/docker-compose.yml" --env-file "$ENV_FILE")

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
err() { log "ERROR: $*" >&2; }
env_get() { { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'; }

usage() {
  echo "Usage: $0 [-h|--help]"
  echo "Orchestrates the full QA environment on the VPS. No arguments."
  echo "Requires: repo at ${QA_ROOT}, filled env file at ${ENV_FILE}."
}

# --------------------------------------------------------------------------
# Preflight — collect ALL failures, print them together, then exit 1.
# --------------------------------------------------------------------------
FAILURES=()
fail() { FAILURES+=("$1"); }

check_ports() {
  local busy="" port stack_up=""
  busy="$(ss -ltn 2>/dev/null | awk 'NR>1 {print $4}')" || busy=""
  if docker compose version >/dev/null 2>&1 && [ -f "$ENV_FILE" ]; then
    [ -n "$("${COMPOSE[@]}" ps -q 2>/dev/null)" ] && stack_up=1
  fi
  for port in 8100 8101 5433 3200 3210 3211; do
    printf '%s\n' "$busy" | grep -Eq "[:.]${port}\$" || continue
    case "$port" in
      8100|8101|5433)
        [ -n "$stack_up" ] && { log "port $port busy but supabase-qa stack is already up — ok (re-run)"; continue; } ;;
      3200)
        systemctl is-active --quiet aureon-frontend-qa 2>/dev/null && { log "port 3200 owned by aureon-frontend-qa — ok (re-run)"; continue; } ;;
      3210|3211)
        systemctl is-active --quiet aureon-agents-qa 2>/dev/null && { log "port $port owned by aureon-agents-qa — ok (re-run)"; continue; } ;;
    esac
    fail "port $port is already in use (ss -ltn) and not owned by the QA stack"
  done
}

preflight() {
  log "preflight checks"
  if [ "${QA_SETUP_SKIP_OS_CHECK:-0}" != "1" ]; then
    [ "$(uname -s)" = "Linux" ] || fail "not Linux (uname: $(uname -s)) — this script only runs on the QA VPS"
  fi

  local t
  for t in docker psql node npm curl ss; do
    command -v "$t" >/dev/null 2>&1 \
      || fail "required tool missing: $t — ask the user to install it (do NOT install packages yourself)"
  done
  if command -v docker >/dev/null 2>&1; then
    docker compose version >/dev/null 2>&1 || fail "docker compose v2 plugin missing (docker compose version failed)"
  fi
  if command -v node >/dev/null 2>&1; then
    local major; major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    [ "${major:-0}" -ge 20 ] 2>/dev/null || fail "node >= 20 required by apps/agents + apps/worker engines (found: $(node -v 2>/dev/null || echo '?'))"
  fi

  if [ -r /proc/meminfo ]; then
    local avail_kb; avail_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
    [ "${avail_kb:-0}" -ge $((3 * 1024 * 1024)) ] 2>/dev/null \
      || fail "need >= 3GB MemAvailable for the stack (have $(( ${avail_kb:-0} / 1024 )) MB)"
  else
    fail "/proc/meminfo not readable — cannot verify free RAM"
  fi

  local avail_gb; avail_gb="$(df -Pk / 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')"
  [ "${avail_gb:-0}" -ge 10 ] 2>/dev/null || fail "need >= 10GB free on / (have ${avail_gb:-?} GB)"

  check_ports

  if [ ! -f "$ENV_FILE" ]; then
    fail "env file missing: $ENV_FILE — run generate-qa-secrets.sh and fill it first"
  else
    local ph
    ph="$( { grep -oE '^[A-Za-z0-9_]+=CHANGE_ME[A-Za-z0-9_]*' "$ENV_FILE" || true; } | cut -d= -f1 | paste -sd ',' - )"
    [ -z "$ph" ] || fail "env file still contains CHANGE_ME placeholders: $ph (note: OPENROUTER_API_KEY is required — agents refuse to boot without it)"
    if grep -q 'supabase\.co' "$ENV_FILE"; then
      fail "env file mentions supabase.co — QA must NEVER point at the production cloud project. ABORTING."
    fi
  fi

  if [ "${#FAILURES[@]}" -gt 0 ]; then
    err "preflight found ${#FAILURES[@]} problem(s):"
    local f; for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f" >&2; done
    exit 1
  fi
  log "preflight OK"
}

# --------------------------------------------------------------------------
# Docker stack
# --------------------------------------------------------------------------
compose_status() { # prints one "service state health" line per service
  "${COMPOSE[@]}" ps --format json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      s = s.trim(); if (!s) return;
      const rows = s.startsWith("[")
        ? JSON.parse(s)
        : s.split("\n").filter(Boolean).map(l => JSON.parse(l));
      for (const r of rows)
        console.log([r.Service || r.Name, r.State, r.Health || "-"].join(" "));
    });'
}

start_stack() {
  log "starting supabase-qa docker stack"
  "${COMPOSE[@]}" up -d
  local deadline=$(( $(date +%s) + STACK_TIMEOUT )) status total bad svc
  while :; do
    status="$(compose_status || true)"
    total="$(printf '%s' "$status" | grep -c . || true)"
    bad="$(printf '%s\n' "$status" | awk 'NF && ($2 != "running" || ($3 != "-" && $3 != "healthy")) {print $1}')"
    if [ "${total:-0}" -gt 0 ] && [ -z "$bad" ]; then
      log "all ${total} compose services running/healthy"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      err "stack not healthy after ${STACK_TIMEOUT}s — current state:"
      "${COMPOSE[@]}" ps >&2 || true
      for svc in $bad; do
        err "--- last 50 log lines: $svc ---"
        "${COMPOSE[@]}" logs --tail 50 "$svc" >&2 || true
      done
      exit 1
    fi
    sleep 5
  done
}

# --------------------------------------------------------------------------
# Database: migrations, seed, QA users
# --------------------------------------------------------------------------
run_migrations() {
  local pw; pw="$(env_get POSTGRES_PASSWORD)"
  [ -n "$pw" ] || { err "POSTGRES_PASSWORD missing in $ENV_FILE"; exit 1; }
  log "applying migrations (localhost:5433)"
  "${SCRIPT_DIR}/apply-migrations.sh" --db-url "postgresql://postgres:${pw}@localhost:5433/postgres"
}

seed_and_users() {
  [ -f "$SEED_SQL" ] || { err "seed file not found: $SEED_SQL"; exit 1; }
  log "applying seed-qa.sql"
  PGPASSWORD="$(env_get POSTGRES_PASSWORD)" psql -h localhost -p 5433 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -q -f "$SEED_SQL"
  log "creating QA users"
  "${SCRIPT_DIR}/create-qa-users.sh" "$ENV_FILE"
}

# --------------------------------------------------------------------------
# App builds (npm workspaces, hoisted node_modules at the repo root)
# --------------------------------------------------------------------------
build_apps() {
  log "npm ci at monorepo root (${QA_ROOT})"
  (cd "$QA_ROOT" && npm ci)
  # NEXT_PUBLIC_* vars are baked in at build time -> env sourced in a subshell
  # only, so NODE_ENV=production etc. do not leak into the other builds.
  log "building frontend (@aureon/frontend) with QA env"
  # shellcheck disable=SC1090  # env file path is runtime-configurable
  (set -a; . "$ENV_FILE"; set +a; cd "$QA_ROOT" && npm run build --workspace=@aureon/frontend)
  log "building agents (@aureon/agents) and worker (@aureon/worker)"
  (cd "$QA_ROOT" && npm run build --workspace=@aureon/agents && npm run build --workspace=@aureon/worker)
}

# --------------------------------------------------------------------------
# systemd units (aureon has passwordless sudo for systemctl — same pattern
# as apps/agents/scripts/deploy.sh)
# --------------------------------------------------------------------------
install_units() {
  log "installing + starting systemd units: ${QA_UNITS[*]}"
  sudo cp "${SCRIPT_DIR}/systemd/aureon-frontend-qa.service" \
          "${SCRIPT_DIR}/systemd/aureon-agents-qa.service" \
          "${SCRIPT_DIR}/systemd/aureon-worker-qa.service" /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now "${QA_UNITS[@]}"
  sudo systemctl restart "${QA_UNITS[@]}"   # pick up new builds on re-runs
}

# --------------------------------------------------------------------------
# Post-checks + summary
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

post_check() {
  log "post-checks (giving services a few seconds to boot)"
  sleep 5
  http_check "kong (8100)"          "http://localhost:8100/"       any
  http_check "frontend (3200)"      "http://localhost:3200/"       success
  http_check "agents health (3210)" "http://localhost:3210/health" success
  local u state
  for u in "${QA_UNITS[@]}"; do
    state="$(systemctl is-active "$u" 2>/dev/null || true)"
    if [ "$state" = "active" ]; then record "unit $u" ok active; else record "unit $u" FAIL "${state:-unknown}"; fi
  done

  echo
  echo "==============================================================="
  echo " QA setup summary"
  echo "==============================================================="
  printf ' %-28s %-6s %s\n' "CHECK" "STATUS" "DETAIL"
  local c n s d
  for c in "${CHECKS[@]}"; do
    IFS='|' read -r n s d <<< "$c"
    printf ' %-28s %-6s %s\n' "$n" "$s" "$d"
  done
  echo "==============================================================="
  if [ "$RESULT" -ne 0 ]; then
    err "one or more post-checks FAILED — inspect: journalctl -u <unit> -n 50 / docker compose logs"
    exit 1
  fi
  log "QA ready: frontend http://localhost:3200 | kong http://localhost:8100 | studio http://localhost:8101"
}

# --------------------------------------------------------------------------
main() {
  case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    "") ;;
    *) err "unknown argument: $1"; usage >&2; exit 1 ;;
  esac

  preflight
  start_stack
  run_migrations
  seed_and_users
  build_apps
  install_units
  post_check
}

# Run only when executed, not when sourced (lets tests source the functions).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
