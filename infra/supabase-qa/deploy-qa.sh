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
#   - packages/database/supabase/tests/*.sql are also run on every deploy, as
#     an ADVISORY post-check (sql_tests_check) — they report pass/fail but can
#     never fail the deploy. See sql_tests_check for why.
#
# Test-only overrides (never set these on the VPS):
#   QA_CHECKOUT_DIR=<path>   QA checkout location (default /home/aureon/aureon-qa)
#   QA_ENV_FILE=<path>       QA env file (default /home/aureon/.env.qa)
#   QA_STATE_FILE=<path>     last-completed-deploy marker (default /home/aureon/.qa-last-deployed-sha)
#   QA_DEGRADED_FILE=<path>  consecutive-degraded-run counter (default <marker>.degraded)
#   QA_DEGRADED_MAX=<n>      degraded runs in a row before the deploy goes red (default 3)
# The script can also be `source`d: functions are defined but nothing runs.

set -Eeuo pipefail   # -E: the ERR trap main() installs must fire inside functions too

QA_CHECKOUT_DIR="${QA_CHECKOUT_DIR:-/home/aureon/aureon-qa}"
QA_ENV_FILE="${QA_ENV_FILE:-/home/aureon/.env.qa}"
QA_STATE_FILE="${QA_STATE_FILE:-/home/aureon/.qa-last-deployed-sha}"
QA_DEGRADED_FILE="${QA_DEGRADED_FILE:-${QA_STATE_FILE}.degraded}"
QA_DEGRADED_MAX="${QA_DEGRADED_MAX:-3}"
# Exit code for "the deploy worked, the marker did not, and it has been that
# way too long". deploy.yml keys its failure message off this — see the
# escalation in record_deploy_marker().
QA_EXIT_MARKER_STREAK=78

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
err() { log "ERROR: $*" >&2; }
env_get() { { grep -E "^${1}=" "$QA_ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'; }
is_true() { [ "${1:-false}" = "true" ]; }

# --------------------------------------------------------------------------
# Failure reporting — an exit 1 from this script must never be mute.
#
# Run 34388997942 read as a silent death: the last log line was "refreshing
# merged edge-functions dir at ...", immediately followed by `##[error]Process
# completed with exit code 1`, no reason anywhere near it. The reason WAS
# printed — `rm: cannot remove '.../index.ts': Permission denied` — but it sat
# ~40 lines EARLIER, spliced into the middle of create-qa-users.sh's user
# list, so reading the log top-to-bottom (or its tail) shows nothing.
#
# Why: this script's own stdout is a pipe to the runner, and libc block-buffers
# it, so every log() line is held and flushed in one burst. A child's stderr is
# unbuffered by convention and arrives the instant it is written. The runner
# timestamps each stream as it reads it, so the two get interleaved by flush
# order, not by program order. Both halves are fixed here:
#
#   - main() re-execs line-buffered, so log() lines land where they happened;
#   - this trap prints an ::error:: annotation naming the line, exit code and
#     command, so the run carries the reason in its summary no matter where
#     the raw stderr ended up in the log body.
on_err() { # $1 = LINENO, $2 = BASH_COMMAND. Installed by main(); needs set -E.
  local ec=$?
  printf '::error::deploy-qa.sh failed at line %s (exit %s): %s\n' "$1" "$ec" "$2" >&2
  printf '::error::QA is NOT in sync with main. Fix the command above and re-run this job.\n' >&2
}

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
#
# spec-88 fase 3, ronda 6 — QA_PREV_SHA reads QA_STATE_FILE, NOT the
# checkout's own `git rev-parse HEAD`, and that distinction is load-bearing.
# `git reset --hard` in this same function runs unconditionally, every run,
# BEFORE any restart/rebuild step below in main() — so the checkout's git
# HEAD reflects "the last commit this run's sync got to," not "the last
# commit whose restarts actually completed." A run that dies partway
# through main() (restart_functions hit a real permission bug on
# 2026-09-09, #718) still leaves the checkout's HEAD at the new commit; the
# NEXT run then reads that already-advanced HEAD as "prev", diffs it
# against an even newer "target", and any file that landed in the commit
# the dead run already checked out silently drops out of that diff —
# CHANGED_QA_COMPOSE included. Confirmed exactly this way in production:
# spec-88 fase 3's own GOTRUE_HOOK_* migration merged, its restart_auth
# call was skipped by this bug, and `docker inspect supabase-qa-auth`
# showed a container still running its pre-merge environment. QA_STATE_FILE
# is written only at the very end of main(), after post_checks() passes —
# so a partial run never advances it, and the next run's diff naturally
# spans back to the last run that TRULY finished, re-triggering every flag
# a dead run left unapplied.
#
# An ABSENT marker reports NOTHING, which widen_changed_flags() turns into
# "rebuild every app". It used to fall back to `git rev-parse HEAD` here, on
# the reasoning that the only way to have no marker was a first run on a
# fresh host. Making the write non-fatal (see record_deploy_marker) created a
# second way, and with it a hole big enough to undo this whole ronda:
#
#   run N   degraded — the marker could not be written at all, deploy green
#   run N+1 sync_checkout's `git reset --hard` lands, then main() dies partway
#           (the #718 permission bug, same day)
#   run N+2 no marker, so prev = HEAD = run N+1's sha — and every file run
#           N+1 checked out but never deployed drops silently out of the diff
#
# That is, word for word, the bug ronda 6 exists to remove. Before the write
# became non-fatal the invariant survived by CRASHING: an unwritable marker
# aborted the deploy. Non-fatal is still right — a good deploy must not die
# over a note — but it has to degrade to the SAFE baseline, not to a
# plausible-looking one. So: no marker, no baseline, rebuild everything.
#
# The cost is one slow run on a genuinely fresh host, which is the case where
# rebuilding everything was correct anyway. The distinction that matters is
# STALE vs ABSENT: a stale marker (the real incident — wrong owner but
# readable) is a safe, older baseline and is still used as one.
# --------------------------------------------------------------------------
# Split out for testability: sync_checkout() also does a real `git fetch`
# against GitHub, which nothing here can stub cheaply. This one function is
# the entire new decision this ronda made, so it is what gets a unit test.
read_qa_prev_sha() {
  if [ -f "$QA_STATE_FILE" ]; then
    cat "$QA_STATE_FILE" 2>/dev/null || true
  fi
}

sync_checkout() {
  cd "$QA_CHECKOUT_DIR"
  QA_PREV_SHA="$(read_qa_prev_sha)"
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
    CHANGED_QA_COMPOSE=true
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
  # The compose file counts as an edge-function change: it carries the
  # runtime's environment block, and nothing else in the deploy recreates that
  # container. Without this, adding a variable to the service changes nothing
  # on the VPS and the deploy still reports success.
  CHANGED_EDGE_FUNCTIONS="$(widen "${CHANGED_EDGE_FUNCTIONS:-false}" '^(packages/database/supabase/functions/|infra/supabase-qa/docker-compose\.yml$)')"
  # spec-88 fase 3, ronda 3 of review — a SEPARATE flag from the one above,
  # scoped only to the compose file itself (not the functions/ dir), because
  # it drives a DIFFERENT container. `restart_functions()` only ever recreated
  # `functions` — a compose edit to any OTHER service's `environment:` block
  # (e.g. `auth`'s GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*, added by
  # 20260922000001) went completely unapplied on the VPS: `deploy-qa` never
  # ran `docker compose up -d auth`, only `setup-qa.sh`'s one-time bootstrap
  # did, and that script is not invoked here. The deploy reported success
  # while the container kept its old environment — silent, and paired with
  # a hook that degrades silently on its own EXCEPTION handler, doubly so.
  # Scoping this to the compose file only avoids recreating `auth` on every
  # unrelated functions/*.ts change.
  CHANGED_QA_COMPOSE="$(widen "${CHANGED_QA_COMPOSE:-false}" '^infra/supabase-qa/docker-compose\.yml$')"

  log "QA was at ${prev} — flags now frontend=${CHANGED_FRONTEND} worker=${CHANGED_WORKER} agents=${CHANGED_AGENTS} edge=${CHANGED_EDGE_FUNCTIONS} compose=${CHANGED_QA_COMPOSE}"
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
# create-qa-users.sh used to stay in setup-qa.sh, on the reasoning that "it
# calls the GoTrue admin API, the users already exist, and it is not needed to
# correct drift". All three premises were wrong or have expired:
#
#   * it does NOT call GoTrue — it inserts into auth.users / auth.identities
#     over psql on localhost:5433, exactly like the seed above;
#   * "the users already exist" holds only until someone adds a NEW one.
#     spec-66 added qa-ops-leader@qa.test and it never reached QA, so the role
#     could not be exercised there at all — the same failure mode as the
#     spec-54 dock zones that motivated seeding on every deploy (#443);
#   * a missing QA user IS drift, of the same kind as a missing seed row.
#
# It is idempotent by construction: every user is existence-checked and
# reported as Created or Skipped, so re-running it changes nothing once QA is
# current. It carries its own production guard (refuses any env file naming
# supabase.co) and pins the connection to localhost.
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

# Create any QA login user the repo declares but QA does not have yet. See the
# block above for why this runs here and not only in setup-qa.sh.
#
# Runs AFTER apply_migrations on purpose: a user whose role is a brand-new enum
# value cannot be inserted until the migration adding that value has applied,
# or the ::user_role cast fails with 22P02.
apply_qa_users() {
  local script="${QA_CHECKOUT_DIR}/infra/supabase-qa/create-qa-users.sh"
  if [ ! -f "$script" ]; then
    err "create-qa-users.sh not found: $script"
    return 1
  fi
  log "ensuring QA login users exist"
  bash "$script" "$QA_ENV_FILE"
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

# Empty the merged edge-functions dir, or say exactly why it could not be.
#
# This replaces the original one-line `rm -rf <merge_dir>/*`, which was latent
# for weeks because CHANGED_EDGE_FUNCTIONS only widens on functions/ or the QA
# compose file, and then took the whole QA sync down on 2026-09-09 (run
# 34388997942). What it got wrong:
#
#   1. Permissions — the actual failure. The dir held files owned by uid
#      197609, a manual copy from a Windows host that preserved numeric ids on
#      2026-08-21. `aureon` owns the parent, so rm could see the entries but
#      not unlink files inside a directory it cannot write: "Permission
#      denied", exit 1 under `set -e`, QA left drifted and the production
#      deploy blocked behind it — with the reason buried mid-log (see on_err).
#   2. Dotfiles — `*` never matches them, so a stale `.something` survived
#      every "wipe" and the mounted dir was never really rebuilt from scratch.
#      `find -mindepth 1` covers both.
#
# (The unexpanded glob on an empty dir is NOT a third bug: `rm -f` ignores a
# nonexistent operand and exits 0. Measured before writing this.)
#
# The dir is rebuilt from the repo on every deploy, so anything the runner
# cannot delete is by definition foreign and will keep failing every future
# deploy until a human intervenes — hence the explicit remediation.
clear_merge_dir() { # $1 = dir to empty
  local dir="$1" survivors wipe_err
  # The wipe's own stderr is captured rather than dropped: the reason a delete
  # failed is the whole point of this function, and guessing it from the file
  # ownership alone gets it wrong (a find that cannot read its starting cwd
  # fails with a message that has nothing to do with permissions on $dir).
  wipe_err="$( { find "$dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} + ; } 2>&1 >/dev/null || true )"
  survivors="$(find "$dir" -mindepth 1 -printf '  %p (owner uid %U, mode %m)
' 2>/dev/null || true)"
  [ -n "$survivors" ] || return 0
  err "cannot clear ${dir} — these entries survived the wipe:"
  printf '%s
' "$survivors" >&2
  if [ -n "$wipe_err" ]; then
    err "what the wipe itself reported:"
    printf '%s
' "$wipe_err" | sed 's/^/  /' >&2
  fi
  err "This directory is rebuilt from the repo on every deploy, so it must be"
  err "entirely owned by the runner user ($(id -un)). Entries owned by another"
  err "uid come from a manual copy that preserved numeric ids — uid 197609, a"
  err "Windows host, is what caused run 34388997942 — or from a container"
  err "writing as root."
  err "Fix on the VPS, as root:  chown -R $(id -un):$(id -gn) ${dir}"
  return 1
}

restart_functions() {
  # Rebuild the merged host dir the compose file mounts (repo functions +
  # vendored main router — see setup-qa.sh merge_functions_dir), then restart.
  local merge_dir="${QA_FUNCTIONS_MERGE_DIR:-/home/aureon/supabase-qa-functions}"
  local infra_dir="${QA_CHECKOUT_DIR}/infra/supabase-qa"
  local src_functions="${QA_CHECKOUT_DIR}/packages/database/supabase/functions"
  local src_main="${infra_dir}/volumes/functions/main"
  # Checked before the wipe, not after: cp failing on a missing source would
  # otherwise leave the mounted dir empty and the edge runtime serving nothing.
  local src
  for src in "$src_functions" "$src_main"; do
    [ -d "$src" ] || { err "edge-functions source missing: $src"; return 1; }
  done
  log "refreshing merged edge-functions dir at ${merge_dir}"
  mkdir -p "$merge_dir"
  clear_merge_dir "$merge_dir"
  cp -a "${src_functions}/." "$merge_dir/"
  cp -a "$src_main" "$merge_dir/"
  # `up -d`, not `restart`: a restart reuses the container's existing config,
  # so anything added to the service's `environment:` block is ignored. That
  # is how BEETRACK_WEBHOOK_SECRET was added, deployed green, and never
  # reached the runtime — the webhook kept answering 500 "Server
  # misconfigured" until the container was recreated by hand. `up -d` is a
  # no-op when nothing about the service changed.
  log "recreating edge functions container"
  docker compose -f "${infra_dir}/docker-compose.yml" \
    --env-file "$QA_ENV_FILE" up -d functions
}

# spec-88 fase 3, ronda 3 — the same "restart reuses old config" trap as
# restart_functions() above, for the `auth` (GoTrue) service. `up -d`, not
# `restart`, for the same reason: a restart would keep serving the
# container's existing environment and ignore anything just added to its
# `environment:` block in docker-compose.yml.
#
# --no-deps (ronda 4): `up -d auth` without it also recreates any dependency
# whose own config-hash changed — `auth` declares `depends_on: db:
# service_healthy`, and `db` is QA's Postgres, carrying Musan's data. A PR
# that ever touches the compose file's `db:` block (not just `auth:`) would
# otherwise recreate that container as a side effect of THIS call, cutting
# every live QA connection for a few seconds (measured: the volume survives,
# so no data loss — access tokens are self-contained JWTs Kong/PostgREST
# validate without asking GoTrue, so live sessions are unaffected either;
# only in-flight queries get dropped). Safe to skip dependency checks here
# specifically because this call runs AFTER apply_migrations/apply_seed/
# apply_qa_users already succeeded against `db` earlier in main() — its
# health is already proven for this run. `restart_functions()` above has the
# same exposure and predates this fix; not touched here, out of scope for
# this phase.
restart_auth() {
  local infra_dir="${QA_CHECKOUT_DIR}/infra/supabase-qa"
  log "recreating auth (GoTrue) container"
  docker compose -f "${infra_dir}/docker-compose.yml" \
    --env-file "$QA_ENV_FILE" up -d --no-deps auth
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

# A deliberate fork of record(): same CHECKS array and table row shape, but
# never touches RESULT. Used only by sql_tests_check — see its comment for why
# a SQL test failure must never be able to fail this deploy.
record_advisory() { CHECKS+=("$1|$2|$3"); }

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

# spec-88 fase 3, ronda 4 — post_checks() had no assertion on `auth`
# (GoTrue) at all. `restart_auth()`'s `up -d` only waits for its
# dependencies (`db`) to be healthy, not for `auth` itself — and a bad hook
# config kills GoTrue on startup (confirmed in ronda 4's review). Without
# this, that scenario reports a green deploy and the failure only surfaces
# 15 minutes later in `e2e-qa` as an opaque `waitForURL` timeout, with
# nothing pointing at GoTrue.
#
# Not an http_check: `auth` publishes no host port (only reachable inside
# the compose network), and Kong does not route GET /auth/v1/health — only
# /verify, /callback, /authorize, /.well-known/jwks.json and /sso/* are
# open, unauthenticated Kong routes (infra/supabase-qa/volumes/api/kong.yml).
# The compose file already declares a container healthcheck for `auth`
# (`wget http://localhost:9999/health` from inside the container) — read
# that instead of inventing a second, less accurate probe from the host.
container_health_check() { # $1 label, $2 container name
  local status
  status="$(docker inspect --format='{{.State.Health.Status}}' "$2" 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    record "$1" ok "healthy"
  else
    record "$1" FAIL "${status:-not found}"
  fi
}

# --------------------------------------------------------------------------
# SQL tests — packages/database/supabase/tests/*.sql, run against QA's live
# Postgres after migrations+seed. ADVISORY ONLY, always, no exceptions:
#
#   - None of these 31 files have ever run anywhere (scripts/pgtap-local.sh:2
#     says outright "NOT used by CI"), so some are near-certain to fail
#     against schema that has moved since they were written.
#   - A few assume fixtures that only pgtap-local.sh's docker bootstrap sets
#     up (shimmed auth.uid()/auth.role()/auth.jwt(), extra auth.users
#     columns) — QA runs the real Supabase image, so that shim shouldn't be
#     needed there, but an untested test file can fail for the wrong reason.
#   - A gate that goes red on day one, from files nobody has ever run, just
#     trains people to click through red — the exact reasoning behind the
#     e2e-qa job in .github/workflows/deploy.yml (see its ADVISORY comment).
#
# record_advisory() (defined above, next to record()) is what makes this
# airtight under `set -euo pipefail`: it appends to CHECKS but never sets
# RESULT, so no matter how many of the 31 files fail, post_checks' final
# `[ "$RESULT" -ne 0 ] && exit 1` cannot see them. Nothing in this function
# calls record() or exits non-zero itself either — every psql invocation is
# guarded with `|| true`, and the function always falls through to its final
# `log` line, which returns 0.
#
# Verified by hand (all 31 files): every one is `BEGIN; ... ROLLBACK;` with
# no COMMIT anywhere, so nothing here can persist — including the one file
# (spec52_open_route_reception.sql) that runs ALTER TABLE ... DISABLE/ENABLE
# TRIGGER mid-test: DDL is transactional in Postgres, so ROLLBACK undoes it
# same as any INSERT. Read-only in effect, against a live environment people
# are testing in right now.
#
# Two files use pgTAP's plan()/finish() instead of RAISE EXCEPTION (detected
# by content — grep for `plan(` — not a hardcoded filename list, so a new
# pgTAP file is picked up automatically). Nothing in the migrations installs
# the pgtap extension, and creating it here would be a schema write this
# function must not make, so those two are skipped with a named reason
# whenever `pgtap` is not in pg_extension.
#
# All 31 run through ONE psql connection (a generated script of \i's, each
# wrapped in \echo markers) rather than 31 separate invocations. Cheaper, and
# safe: each file already opens and closes its own transaction, so one file's
# RAISE EXCEPTION (which aborts only its own transaction) can't touch the
# next file's BEGIN. ON_ERROR_STOP is deliberately left at psql's default of
# 0 here — unlike apply_seed's ON_ERROR_STOP=1 — specifically so an error in
# file 5 does not stop files 6 through 31 from running.
#
# Failure detection matches scripts/pgtap-local.sh's `run` case: grep the
# captured output for "ERROR:" (a RAISE EXCEPTION) rather than trust psql's
# process exit status, which stays 0 even when a statement inside the script
# errored (that is what ON_ERROR_STOP=1 would change, and we don't set it).
# Anchored on the colon, not bare "ERROR" — the same imprecision
# pgtap-local.sh's own comment (:167-172 as of #717) documents avoiding, since
# an unanchored match can hit the word inside an otherwise-passing message.
# pgTAP failures don't raise, so pgTAP sections are additionally grepped for
# TAP's "not ok N" failure marker. Matched as "not ok [0-9]", not "not ok "
# (trailing space) — pgTAP prints a bare "not ok N" with no trailing space
# or description for a one/two-arg assertion (`ok(false)`, `is(a, b)`), and
# the space-anchored form used to miss it silently (see scripts/pgtap-local.sh).
# --------------------------------------------------------------------------
sql_tests_check() {
  local pw; pw="$(env_get POSTGRES_PASSWORD)"
  if [ -z "$pw" ]; then
    record_advisory "sql tests" SKIP "POSTGRES_PASSWORD missing"
    return 0
  fi

  local tests_dir="${QA_CHECKOUT_DIR}/packages/database/supabase/tests"
  if [ ! -d "$tests_dir" ]; then
    record_advisory "sql tests" SKIP "tests dir not found: $tests_dir"
    return 0
  fi

  shopt -s nullglob
  local files=("$tests_dir"/*.sql)
  shopt -u nullglob
  if [ ${#files[@]} -eq 0 ]; then
    record_advisory "sql tests" SKIP "no *.sql files in $tests_dir"
    return 0
  fi

  local psql_qa=(psql -h localhost -p 5433 -U postgres -d postgres)
  local pgtap_ok
  pgtap_ok="$(PGPASSWORD="$pw" "${psql_qa[@]}" -tAc \
    "SELECT 1 FROM pg_extension WHERE extname = 'pgtap'" 2>/dev/null || true)"

  local begin_tag="__SQLTEST_BEGIN__" end_tag="__SQLTEST_END__"
  local runner; runner="$(mktemp)"
  local f base
  for f in "${files[@]}"; do
    base="$(basename "$f")"
    echo "\\echo ${begin_tag} ${base}" >> "$runner"
    if grep -q 'plan(' "$f" && [ "$pgtap_ok" != "1" ]; then
      echo "\\echo SKIPPED-NO-PGTAP" >> "$runner"
    else
      echo "\\i '${f}'" >> "$runner"
    fi
    echo "\\echo ${end_tag} ${base}" >> "$runner"
  done

  local output
  output="$(PGPASSWORD="$pw" "${psql_qa[@]}" -v ON_ERROR_STOP=0 -q -f "$runner" 2>&1 || true)"
  rm -f "$runner"

  local pass=0 fail=0 skip=0 section
  for f in "${files[@]}"; do
    base="$(basename "$f")"
    section="$(printf '%s\n' "$output" | awk -v b="$begin_tag $base" -v e="$end_tag $base" \
      '$0==b{on=1;next} $0==e{on=0} on')"
    if printf '%s' "$section" | grep -q "SKIPPED-NO-PGTAP"; then
      skip=$((skip + 1))
      record_advisory "sql: $base" SKIP "pgtap extension not installed on QA"
    elif printf '%s' "$section" | grep -qE "ERROR:|not ok [0-9]"; then
      fail=$((fail + 1))
      # Echo the failing lines. Without this the summary row says "see the
      # deploy log" and the log does not contain it — the section lives only in
      # $output, which is never printed. A check that reports a failure you
      # cannot diagnose is barely better than no check, and this one is
      # advisory, so the log IS the whole product.
      log "--- $base failed, first 20 offending lines:"
      printf '%s
' "$section" | grep -E "ERROR:|not ok [0-9]|EXCEPTION" | head -20 | sed 's/^/    /'
      record_advisory "sql: $base" FAIL "see the block above this table"
    else
      pass=$((pass + 1))
      record_advisory "sql: $base" ok ""
    fi
  done
  log "sql tests (advisory): pass=$pass fail=$fail skip=$skip"
}

post_checks() {
  log "post-checks (giving restarted services a few seconds to boot)"
  sleep 5
  http_check "kong (8100)" "http://localhost:8100/" any
  db_check
  container_health_check "auth (GoTrue)" supabase-qa-auth
  # Checked for the same reason as auth, and because of a concrete miss: the
  # edge runtime took a SIGTERM on 2026-09-07 and stayed down for two days
  # without a single deploy noticing — every merge in between reported QA
  # healthy while the beetrack webhook was dead.
  container_health_check "edge functions" supabase-qa-edge-functions
  sql_tests_check
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
# Replace $1's contents with $2, atomically, without ever leaving a partial
# file behind. Returns non-zero instead of dying, so callers decide.
#
# Writes a temp beside the target and renames. rename(2) needs write
# permission on the DIRECTORY, not on the target file, which is why this
# recovers the incident's own shape: a marker owned by root inside a home
# owned by the runner is simply replaced, and ends up owned by the runner.
#
# The -d guard is not paranoia: `mv -f file dir` moves the file INSIDE dir and
# exits 0, so a path some stray mkdir turned into a directory would report a
# successful write having written nothing. `mv -T` would cover it but is
# GNU-only; the guard and its test are portable.
write_atomic() { # $1 path, $2 content
  local path="$1" content="$2" tmp="$1.tmp.$$"
  # Sweep temps a killed run left behind (SIGKILL between write and rename).
  # Here rather than in the caller so it covers EVERY path this writes: the
  # counter's temp is "<marker>.degraded.tmp.<pid>", which a glob anchored on
  # the marker name alone does not match — one orphaned byte, forever.
  # Safe to take all of them, not just this pid's: the workflow's `qa-deploy`
  # concurrency group guarantees one QA sync at a time on this host.
  rm -f "$path".tmp.* 2>/dev/null || true
  [ ! -d "$path" ] || return 1
  if printf '%s' "$content" > "$tmp" 2>/dev/null && mv -f "$tmp" "$path" 2>/dev/null; then
    return 0
  fi
  rm -f "$tmp" 2>/dev/null || true
  return 1
}

# --------------------------------------------------------------------------
# Records the last-FULLY-COMPLETED deploy for the next run's baseline. Called
# as the final statement of main(), after post_checks() has passed — see the
# call site and read_qa_prev_sha() for why the position matters.
#
# Best-effort ON PURPOSE. Ronda 6 wrote the marker as a bare
# `printf ... > "$QA_STATE_FILE"` under `set -Eeuo pipefail`, which made an
# unwritable marker abort a deploy in which every actual step had succeeded.
# It did, five runs running (34397163949 -> 34422244965, 2026-09-09): the
# marker on the VPS was `root:root 0644` inside aureon's home, seeded by hand
# over SSH during this same spec's catch-up, while the runner executes as
# `aureon` — so the open got EACCES. Since spec-57 made a green QA sync
# production's precondition, that unwritable note blocked every production
# deploy for the day. Same class as #718's root-owned edge-functions dir.
#
# The marker is an OPTIMISATION of widen_changed_flags()' diff, not a
# correctness guarantee, so failing a deploy whose every real step passed is
# the wrong trade. But "degrade" has to mean the SAFE direction, and the first
# cut of this did not: losing the marker made the next run inherit the
# checkout's HEAD as its baseline, which is precisely the stale-baseline bug
# ronda 6 removed. read_qa_prev_sha() now reports no baseline at all when the
# marker is absent, so a degraded run costs a full rebuild — never a skipped
# one. That is what makes carrying on safe rather than merely quiet.
#
# Degrading silently forever is its own failure, though: the warning lands on
# a GREEN run, and nobody owns a yellow annotation. So consecutive degraded
# runs are counted, and the streak escalates to a red deploy. One bad run is
# noise; a standing misconfiguration is an outage waiting for the next #718.
record_deploy_marker() {
  local sha="${QA_SYNCED_SHA:-${DEPLOY_SHA}}"
  local runner; runner="$(id -un 2>/dev/null || echo '?')"

  if write_atomic "$QA_STATE_FILE" "$sha"; then
    rm -f "$QA_DEGRADED_FILE" 2>/dev/null || true
    return 0
  fi

  # ::warning:: so it surfaces in the run summary, not only in the log body —
  # and on stderr, which this script's header explains is the stream that is
  # not block-buffered and so arrives where it actually happened.
  printf '::warning::deploy-qa.sh could not write the deploy marker %s — the deploy itself SUCCEEDED.\n' \
    "$QA_STATE_FILE" >&2
  err "could not write the deploy marker ${QA_STATE_FILE}"
  err "the deploy itself SUCCEEDED and QA is in sync at ${sha} — this is NOT a failed sync"
  err "consequence: the next run falls back to the last recorded marker, or to a full"
  err "rebuild if there is none — never to the checkout's HEAD."
  err "that is slow at worst, never unsafe — QA is not left under-deployed by this."
  err "cause is almost always a marker owned by the wrong user — the runner runs as ${runner}:"
  err "  $(ls -ld "$QA_STATE_FILE" 2>&1 || true)"
  err "  $(ls -ld "$(dirname "$QA_STATE_FILE")" 2>&1 || true)"
  err "fix on the VPS: sudo chown ${runner} ${QA_STATE_FILE}"

  local streak
  streak="$(cat "$QA_DEGRADED_FILE" 2>/dev/null || echo 0)"
  case "$streak" in ''|*[!0-9]*) streak=0 ;; esac
  streak=$((streak + 1))
  if ! write_atomic "$QA_DEGRADED_FILE" "$streak"; then
    # Nothing beside the marker is writable, so no streak can be remembered
    # and this can never escalate on its own. Say so rather than imply the
    # counter below is watching.
    err "the degraded-run counter ${QA_DEGRADED_FILE} is unwritable too, so this cannot escalate"
    err "on its own — it will warn on every run until someone fixes the directory."
    return 0
  fi

  if [ "$streak" -ge "$QA_DEGRADED_MAX" ]; then
    printf '::error::deploy-qa.sh has failed to record the deploy marker %s times in a row.\n' \
      "$streak" >&2
    err "FAILING THE DEPLOY on purpose: ${streak} consecutive runs could not write ${QA_STATE_FILE}."
    err "each of those runs deployed QA correctly; each one diffed from whatever marker was"
    err "already on disk, or rebuilt every app if there was none — never against a false"
    err "baseline. The warning just sat on a green run where nobody owned it. Fix the"
    err "permissions and re-run:"
    err "  sudo chown ${runner} ${QA_STATE_FILE} $(dirname "$QA_STATE_FILE")"
    # A DISTINCT code, not 1. The workflow's generic failure step says "QA is
    # now drifted from main", which here would be a lie: QA is in sync, only
    # the note failed, and every run that led here still deployed correctly.
    # deploy.yml branches on this code to print the true diagnosis.
    # A wrong reason attached to a correct red is how #718 cost two hours.
    exit "$QA_EXIT_MARKER_STREAK"
  fi
  log "degraded run ${streak}/${QA_DEGRADED_MAX} — the deploy stays green until the streak reaches the limit"
  return 0
}

main() {
  # Re-exec line-buffered so this script's log lines interleave with children's
  # stderr in the order they actually happened — see on_err() for the failure
  # this ordering bug produced. Guarded by the env var so the exec runs once,
  # skipped on a terminal (already line-buffered) and where stdbuf is absent.
  if [ -z "${DEPLOY_QA_LINE_BUFFERED:-}" ] && [ ! -t 1 ] && command -v stdbuf >/dev/null 2>&1; then
    export DEPLOY_QA_LINE_BUFFERED=1
    exec stdbuf -oL -eL bash "$0" "$@"
  fi
  trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR

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
  apply_qa_users
  if is_true "${CHANGED_EDGE_FUNCTIONS:-}"; then restart_functions; fi
  if is_true "${CHANGED_QA_COMPOSE:-}"; then restart_auth; fi
  if is_true "${CHANGED_FRONTEND:-}"; then deploy_frontend; fi
  if is_true "${CHANGED_AGENTS:-}"; then deploy_node_app agents; fi
  if is_true "${CHANGED_WORKER:-}"; then deploy_node_app worker; fi
  post_checks
  # spec-88 fase 3, ronda 6 — only reached if post_checks() did not `exit 1`
  # above, i.e. every CHANGED_* restart/rebuild this run attempted actually
  # completed and passed health checks. Recording it HERE, not any earlier,
  # is what makes a partial run (dies mid-main(), e.g. restart_functions'
  # #718 permission bug) leave the marker untouched — see sync_checkout's
  # comment on QA_PREV_SHA for what breaks otherwise.
  #
  # Deliberately the last statement AND deliberately non-fatal: ronda 6 wrote
  # it inline under `set -e` and an unwritable marker then failed five
  # consecutive deploys whose every real step had passed. record_deploy_marker
  # warns and returns 0 instead — the whole rationale is on the function.
  record_deploy_marker
}

# Run only when executed, not when sourced (lets tests source the functions).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
