#!/usr/bin/env bash
# deploy-qa.sh — keeps the VPS QA environment in sync on every green main merge
# (spec-48). Invoked by the deploy-qa job in .github/workflows/deploy.yml on the
# self-hosted VPS runner.
#
# DELIBERATE exception to the repo's 300-line-file guideline (m4, spec-93
# fase 3 review). This file is one orchestration script with a single
# responsibility — one main() calling a sequence of guard/sync/restart/
# check functions — not a module whose growth signals it should be split
# into smaller units with their own responsibilities. Every prior addition
# (spec-88's auth/functions restart helpers, this fase's pgtap/generic
# compose-recreate helpers) followed the SAME pattern already established
# here rather than inventing a new one, which is what the reviewer
# confirmed as defensible; splitting it would scatter one deploy's control
# flow across files for no isolation benefit, since every function here
# runs in the same process against the same QA host in the same order.
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
#   - packages/database/supabase/tests/*.sql are also run on every deploy
#     (sql_tests_check). A real test failure (spec-92) fails the deploy; a
#     SKIP for a missing prerequisite (no password, no tests dir, no *.sql
#     files, or a single pgTAP file with pgtap not installed) never does.
#     See sql_tests_check for why.
#
# Test-only overrides (never set these on the VPS):
#   QA_CHECKOUT_DIR=<path>        QA checkout location (default /home/aureon/aureon-qa)
#   QA_ENV_FILE=<path>            QA env file (default /home/aureon/.env.qa)
#   QA_STATE_FILE=<path>          last-completed-deploy marker (default /home/aureon/.qa-last-deployed-sha)
#   QA_DEGRADED_FILE=<path>       consecutive-degraded-run counter (default <marker>.degraded)
#   QA_DEGRADED_MAX=<n>           degraded runs in a row before the deploy goes red (default 3)
#   QA_PGTAP_DEGRADED_FILE=<path> consecutive CREATE-EXTENSION-pgtap failures (default <marker>.pgtap-degraded)
#   QA_PGTAP_DEGRADED_MAX=<n>     failures in a row before the deploy goes red (default 3)
# The script can also be `source`d: functions are defined but nothing runs.

set -Eeuo pipefail   # -E: the ERR trap main() installs must fire inside functions too

QA_CHECKOUT_DIR="${QA_CHECKOUT_DIR:-/home/aureon/aureon-qa}"
QA_ENV_FILE="${QA_ENV_FILE:-/home/aureon/.env.qa}"
QA_STATE_FILE="${QA_STATE_FILE:-/home/aureon/.qa-last-deployed-sha}"
QA_DEGRADED_FILE="${QA_DEGRADED_FILE:-${QA_STATE_FILE}.degraded}"
QA_DEGRADED_MAX="${QA_DEGRADED_MAX:-3}"
QA_PGTAP_DEGRADED_FILE="${QA_PGTAP_DEGRADED_FILE:-${QA_STATE_FILE}.pgtap-degraded}"
QA_PGTAP_DEGRADED_MAX="${QA_PGTAP_DEGRADED_MAX:-3}"
# Exit code for "the deploy worked, the marker did not, and it has been that
# way too long". deploy.yml keys its failure message off this — see the
# escalation in record_deploy_marker().
QA_EXIT_MARKER_STREAK=78
# spec-93 fase 3, review round — same escalation pattern as
# QA_EXIT_MARKER_STREAK, for CREATE EXTENSION pgtap failing repeatedly. A
# DISTINCT code from 78: the marker's 78 means "QA is fine, only a note
# failed"; this one means "QA is fine, only pgtap testing is broken" — a
# different diagnosis deploy.yml's failure step must be able to tell apart.
QA_EXIT_PGTAP_STREAK=79

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

# --------------------------------------------------------------------------
# spec-93 fase 3 — generalizes restart_functions()/restart_auth() to the
# other services in docker-compose.yml. Measured 2026-09-10 (`docker inspect
# ... .State.StartedAt`): kong/rest/realtime/storage had not been recreated
# since 2026-08-11, not because anything is currently drifted (the only
# compose edits since then, #710 and #497, touched auth/edge and both
# already have a dedicated helper above) but because the MECHANISM only ever
# covered the two services someone happened to hit the BEETRACK_WEBHOOK
# trap on. The next edit to, say, `rest`'s environment block would hit that
# exact trap again, silently — restart_functions/restart_auth fix the
# instance, not the pattern.
#
# compose_changed_services() finds which service BLOCK actually changed
# between two revisions of docker-compose.yml — not "did the file change",
# which would recreate every service (including `db`) on any unrelated
# edit. It works on unified diff hunks (`--unified=0`, so hunk headers give
# exact new-file line ranges) mapped against the TARGET file's own
# top-level `  <service>:` block boundaries — and the target file is what's
# on disk, since sync_checkout() has already reset the checkout to
# QA_SYNCED_SHA by the time this runs in main().
#
# QA_PREV_SHA/QA_SYNCED_SHA — the exact same two values sync_checkout()
# computed and widen_changed_flags() already keys off — not the checkout's
# raw `git rev-parse HEAD`. That is deliberately the #721 fix
# (read_qa_prev_sha()'s comment above tells the incident in full): HEAD
# advances as soon as `git reset --hard` runs, before any restart in this
# same main() has actually completed, so a run that dies partway through
# would poison the NEXT run's baseline with a commit whose restarts never
# ran. Reusing QA_PREV_SHA/QA_SYNCED_SHA here means this function inherits
# that fix for free instead of re-deriving a baseline of its own — and
# re-deriving one is exactly how a second copy of #721 would get written.
compose_changed_services() { # $1 prev sha, $2 target sha -> one service per line
  local prev="$1" target="$2"
  local rel="infra/supabase-qa/docker-compose.yml"
  local compose_file="${QA_CHECKOUT_DIR}/${rel}"
  [ -f "$compose_file" ] || return 0

  # No usable baseline (absent marker, or a sha the checkout no longer has —
  # same two cases widen_changed_flags:210-220 already names). Review round:
  # the first cut of this function returned NOTHING here, the opposite of
  # widen_changed_flags' own doctrine ("no baseline -> rebuild everything;
  # slow is fine, silently stale is not"). Concretely unsafe: if the deploy
  # marker degrades (record_deploy_marker's documented non-fatal path) for
  # even one run, and THAT run's compose diff includes an edit to, say,
  # `rest`, returning nothing here means `rest` never recreates — and once
  # the marker recovers, that same commit is now behind QA_PREV_SHA and can
  # never appear in a future diff again. `rest` would run stale config
  # forever, silently. Recreating every entry in RECREATABLE_QA_SERVICES
  # costs one slow run; not recreating them risks exactly that permanently.
  if [ -z "$prev" ] || ! git -C "$QA_CHECKOUT_DIR" rev-parse -q --verify "${prev}^{commit}" >/dev/null 2>&1; then
    printf '%s\n' ${RECREATABLE_QA_SERVICES}
    return 0
  fi

  [ "$prev" != "$target" ] || return 0

  local diff_out
  diff_out="$(git -C "$QA_CHECKOUT_DIR" diff --unified=0 "$prev" "$target" -- "$rel" 2>/dev/null || true)"
  [ -n "$diff_out" ] || return 0

  # Top-level `  <service>:` block ranges in the file AS IT STANDS NOW (the
  # target revision — see the comment above for why no extra `git show` is
  # needed). Scoped to the `services:` section only: `volumes:`/`networks:`
  # footers use the same two-space-then-colon shape and would otherwise be
  # misread as services.
  local ranges
  ranges="$(awk '
    /^services:$/ { insvc=1; next }
    insvc && /^[A-Za-z]/ {
      if (name != "") { print name, start, NR - 1; name = "" }
      insvc = 0
    }
    insvc && /^  [A-Za-z0-9_-]+:$/ {
      if (name != "") print name, start, NR - 1
      name = $1; sub(":$", "", name); start = NR
    }
    END { if (name != "") print name, start, NR }
  ' "$compose_file")"
  [ -n "$ranges" ] || return 0

  # Hunk headers (`@@ -a,b +c,d @@`) give the changed range in the NEW file
  # as `c,d` — `d` defaults to 1 when omitted. A pure deletion has `d=0`
  # (nothing added at that position); treated as a single-line marker at `c`
  # rather than dropped, so a deletion that shrinks a block still attributes
  # to the block it shrank.
  local hunks
  hunks="$(printf '%s\n' "$diff_out" | grep -oE '^@@ -[0-9]+(,[0-9]+)? \+[0-9]+(,[0-9]+)? @@' \
    | sed -E 's/^@@ -[0-9]+(,[0-9]+)? \+([0-9]+)(,([0-9]+))? @@/\2 \4/')"
  [ -n "$hunks" ] || return 0

  local start count end svc s e
  while read -r start count; do
    [ -n "$start" ] || continue
    count="${count:-1}"
    if [ "$count" -eq 0 ]; then end="$start"; else end=$((start + count - 1)); fi
    while read -r svc s e; do
      [ -n "$svc" ] || continue
      if [ "$end" -ge "$s" ] && [ "$start" -le "$e" ]; then
        printf '%s\n' "$svc"
      fi
    done <<< "$ranges"
  done <<< "$hunks" | sort -u
}

# Every service it is safe to blind-recreate on a compose edit. Review
# round: the first cut of this excluded studio/imgproxy/meta with "nothing
# was measured drifting on them" — the exact reasoning that left this same
# fase's kong/rest/realtime/storage gap open in the first place (nothing was
# measured drifting on THEM either, until it was). Risk, not measurement, is
# what should decide membership, so all three are IN: none carries state,
# none has a dependent whose connections would be cut (imgproxy/meta have no
# other service `depends_on` them; studio has none at all).
#
# Only two kinds of exclusion remain, both for reasons that don't evaporate
# just because nothing has drifted yet:
#   - `db` — stateful (carries Musan's data). A block change to `db` itself
#     is a deliberate, reviewed operational decision, not something that
#     should auto-recreate the container and cut every live connection as a
#     side effect of a green merge.
#   - `functions`/`auth` — already covered by restart_functions()/
#     restart_auth() via CHANGED_EDGE_FUNCTIONS/CHANGED_QA_COMPOSE; adding
#     them here too would just recreate the same container twice.
RECREATABLE_QA_SERVICES="kong rest realtime storage imgproxy meta studio"

# `up -d --no-deps`, not `restart`, for the same reason as
# restart_functions()/restart_auth() above: `restart` reuses the container's
# existing config, so a compose edit to this service never reaches it.
# `--no-deps`: every service in RECREATABLE_QA_SERVICES depends (directly,
# or for `storage` transitively via `rest`/`imgproxy`) on `db: service_
# healthy` — without it, `up -d <svc>` would also recreate `db` whenever
# db's OWN config-hash changed, taking QA's Postgres down as a side effect
# of an unrelated service's compose edit. Same fix, same reasoning,
# restart_auth() ronda 4.
recreate_qa_service() { # $1 compose service name
  local infra_dir="${QA_CHECKOUT_DIR}/infra/supabase-qa"
  log "recreating ${1} (compose block changed)"
  docker compose -f "${infra_dir}/docker-compose.yml" \
    --env-file "$QA_ENV_FILE" up -d --no-deps "$1"
}

# Ties compose_changed_services() to RECREATABLE_QA_SERVICES and
# recreate_qa_service(). Split out of main() (review round): the allow-list
# filter here — which services this fase's fix actually reaches — was the
# one piece of this mechanism no test exercised end to end. A test asserting
# only that "kong" gets recreated, or grepping the RECREATABLE_QA_SERVICES
# string, cannot tell a filter that also lets `db` through from one that
# doesn't, or a filter that silently covers only `kong` from one that covers
# all seven. Pulling this into its own function makes that filter callable
# in isolation against a stubbed `docker`.
recreate_changed_qa_services() { # $1 prev sha, $2 target sha
  local svc
  for svc in $(compose_changed_services "$1" "$2"); do
    case " ${RECREATABLE_QA_SERVICES} " in
      *" ${svc} "*) recreate_qa_service "$svc" ;;
    esac
  done
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
# pgtap — spec-93 fase 3. Measured against QA 2026-09-10:
#   SELECT count(*) FROM pg_extension WHERE extname='pgtap'          -> 0
#   SELECT default_version FROM pg_available_extensions
#     WHERE name='pgtap'                                             -> 1.3.3
# The extension is available in the image but nothing ever created it, so
# sql_tests_check()'s own SKIPPED-NO-PGTAP path has been silently skipping
# all 20 packages/database/supabase/tests/*.sql files that use plan()/
# finish() since they were written — a green check that never ran them.
#
# Three places could own `CREATE EXTENSION pgtap`; this one does, and here
# is why the other two don't:
#   - packages/database/supabase/migrations/ — apply_migrations() replays
#     this same ledger against PRODUCTION (see apps/worker/scripts/
#     deploy.sh), so a migration here would install a testing-only extension
#     in prod, which is exactly the parity gap this spec is about closing in
#     the OTHER direction. Ruled out.
#   - infra/supabase-qa/setup-qa.sh — the one-time bootstrap. It only runs
#     when QA is first provisioned, not on docs/qa-environment.md's "DB
#     reset — full clean rebuild" (data dir wiped, migrations replayed).
#     An extension created only there would be lost on the very reset this
#     fix has to survive.
#   - HERE, deploy-qa.sh — runs on every green merge, same as
#     apply_migrations/apply_seed above, and `CREATE EXTENSION IF NOT
#     EXISTS` is idempotent — a no-op once installed, and self-healing after
#     a DB reset without anyone re-running a bootstrap script by hand.
#
# ADVISORY for a single run, same pattern as sql_tests_check() right below
# (record_advisory, never touches RESULT): installing a test-only extension
# must not be able to fail a QA deploy whose real steps all passed on the
# FIRST run it happens to fail. Must run BEFORE sql_tests_check — see the
# call site in post_checks().
#
# NOT advisory forever, though — review round on this fase caught that a
# permanent CREATE EXTENSION failure (e.g. the QA role lacking the
# privilege — pgtap is NOT trusted and needs a superuser) would sit as a
# FAIL row on an otherwise-green run indefinitely: `sql_tests_check` would
# keep reporting SKIPPED-NO-PGTAP for all 20 pgTAP files forever, functionally
# identical to the bug this fase exists to close, just with a FAIL row
# nobody reads. Same escalation record_deploy_marker() already uses for
# exactly this shape of problem (a real, harmless-today failure that must
# not be allowed to degrade silently forever): count consecutive failures in
# QA_PGTAP_DEGRADED_FILE, and once the streak reaches QA_PGTAP_DEGRADED_MAX,
# fail the deploy on purpose with a DISTINCT exit code (QA_EXIT_PGTAP_STREAK,
# not QA_EXIT_MARKER_STREAK) so deploy.yml's failure step can print the
# right diagnosis instead of "QA is drifted".
ensure_pgtap() {
  local pw; pw="$(env_get POSTGRES_PASSWORD)"
  if [ -z "$pw" ]; then
    record_advisory "pgtap extension" SKIP "POSTGRES_PASSWORD missing"
    return 0
  fi

  log "ensuring pgtap extension exists (localhost:5433)"
  local out
  if out="$(PGPASSWORD="$pw" psql -h localhost -p 5433 -U postgres -d postgres \
       -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS pgtap;' 2>&1)"; then
    record_advisory "pgtap extension" ok "installed"
    rm -f "$QA_PGTAP_DEGRADED_FILE" 2>/dev/null || true
    return 0
  fi

  err "could not create pgtap extension: $out"
  record_advisory "pgtap extension" FAIL "CREATE EXTENSION failed — see deploy log"
  # ::warning:: so it surfaces in the run summary, not only in the log body —
  # same reasoning as record_deploy_marker()'s warning: a FAIL row inside the
  # post-checks table is easy to scroll past on an otherwise-green deploy.
  printf '::warning::deploy-qa.sh could not create the pgtap extension — sql_tests_check will keep SKIPPING every pgTAP file until this is fixed.\n' >&2

  local streak
  streak="$(cat "$QA_PGTAP_DEGRADED_FILE" 2>/dev/null || echo 0)"
  case "$streak" in ''|*[!0-9]*) streak=0 ;; esac
  streak=$((streak + 1))
  if ! write_atomic "$QA_PGTAP_DEGRADED_FILE" "$streak"; then
    err "the pgtap degraded-run counter ${QA_PGTAP_DEGRADED_FILE} is unwritable too, so this cannot escalate on its own"
    return 0
  fi

  if [ "$streak" -ge "$QA_PGTAP_DEGRADED_MAX" ]; then
    printf '::error::deploy-qa.sh has failed to create the pgtap extension %s times in a row.\n' "$streak" >&2
    err "FAILING THE DEPLOY on purpose: ${streak} consecutive runs could not CREATE EXTENSION pgtap."
    err "every other QA step this run attempted still succeeded — this is not a drifted QA,"
    err "only pgtap testing is broken."
    err "likely cause: the role in POSTGRES_PASSWORD lacks the privilege — pgtap is NOT trusted"
    err "and needs a superuser, which in the Supabase images is supabase_admin, not postgres."
    err "fix on the VPS: either grant the privilege or point ensure_pgtap at a superuser role."
    exit "$QA_EXIT_PGTAP_STREAK"
  fi
  log "pgtap degraded run ${streak}/${QA_PGTAP_DEGRADED_MAX} — the deploy stays green until the streak reaches the limit"
  return 0
}

# --------------------------------------------------------------------------
# SQL tests — packages/database/supabase/tests/*.sql, run against QA's live
# Postgres after migrations+seed.
#
# BLOCKING as of spec-92, for the per-file pass/fail rows only. Through
# 2026-09-09 this whole function was advisory-only, because none of these
# files had ever run anywhere (scripts/pgtap-local.sh:2 said outright "NOT
# used by CI") and pgtap wasn't even installed on QA — every plan()-based
# file silently SKIPPED, so "green" meant "mostly untested", and gating a
# deploy on that would have been theater. spec-93 fase 3 installed pgtap on
# QA (ensure_pgtap, above) and the last real run against it came back clean:
# pass=91 fail=0 skip=0. A file that has actually run and passed is exactly
# the kind of result that SHOULD gate a deploy — that's the whole point of
# this fase.
#
# What is STILL advisory, deliberately, and must stay that way: any SKIP,
# because a SKIP here always means "a prerequisite to running the tests was
# absent", never "a test ran and failed". Converting a missing
# POSTGRES_PASSWORD, a missing tests dir, an empty tests dir, or a single
# pgTAP file skipped for lack of the pgtap extension into a hard failure
# would fail deploys for reasons that have nothing to do with SQL
# correctness — a checkout without a password, or a fresh QA box mid-bootstrap,
# would redden every deploy until someone fixes the environment, not the
# SQL. The pgtap-missing case in particular is NOT a silent pass either:
# ensure_pgtap() (above) already escalates a persistent CREATE-EXTENSION
# failure into a hard deploy failure of its own (QA_PGTAP_DEGRADED_MAX,
# QA_EXIT_PGTAP_STREAK) after QA_PGTAP_DEGRADED_MAX consecutive runs, so a
# genuinely broken pgtap install cannot hide behind SKIPPED-NO-PGTAP
# forever — that escalation lives there once, not duplicated here.
#
# record() (used for every per-file ok/FAIL row below) is what makes real
# test results reach post_checks' final `[ "$RESULT" -ne 0 ] && exit 1`.
# record_advisory() (defined above, next to record()) is reserved for the
# four SKIP paths described above — appends to CHECKS but never touches
# RESULT, so an absent prerequisite can never redden the deploy by itself.
# Nothing in this function calls exit non-zero itself either — every psql
# invocation is guarded with `|| true`, and the function always falls
# through to its final `log` line and returns 0; post_checks() is the only
# place that turns RESULT into an actual exit.
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

  # rc is captured, not swallowed with a blind `|| true`: a nonzero exit here
  # (psql couldn't even connect, or was killed mid-run) is a different failure
  # mode from ON_ERROR_STOP=0 letting individual files error while the rest
  # keep running (which still exits 0) — it's used below only to make the
  # per-file "did not run" diagnosis readable, never to decide pass/fail on
  # its own, since a partial run (some files' markers present, some not)
  # needs the per-file marker check regardless of the overall exit code.
  local output rc
  output="$(PGPASSWORD="$pw" "${psql_qa[@]}" -v ON_ERROR_STOP=0 -q -f "$runner" 2>&1)" && rc=0 || rc=$?
  rm -f "$runner"

  local pass=0 fail=0 skip=0 section
  for f in "${files[@]}"; do
    base="$(basename "$f")"
    # A file that never ran must never score "ok" — that would be a green
    # check that saw nothing (the exact failure mode this fase exists to
    # close: 2026-09-10 review round on this fase found sql_tests_check
    # scored a connection-refused psql run as "ok" for every file, because
    # it grepped $output for "ERROR:"/"not ok" and a connection failure
    # prints lowercase "error:" and produces NO \echo output at all — every
    # per-file section came back empty and fell through to the pass branch.
    # A mid-run death (psql killed partway through) has the identical shape
    # for every file after the point of death: no BEGIN/END pair. Fixed by
    # requiring BOTH markers to be literally present in $output before a
    # file's content is even inspected — grep -F/-x, not the awk scan below,
    # so a missing marker can't be masked by a coincidental text match.
    # FAIL, not SKIP: SKIP means an ABSENT PREREQUISITE (see the four
    # record_advisory() paths above and in this loop); here the prerequisite
    # (files, password, pgtap) was present and the run itself broke, which is
    # a different failure the deploy must see.
    if ! printf '%s\n' "$output" | grep -qxF "$begin_tag $base" \
        || ! printf '%s\n' "$output" | grep -qxF "$end_tag $base"; then
      fail=$((fail + 1))
      log "--- $base did not run: psql produced no ${begin_tag}/${end_tag} pair for it" \
        "(psql exit status ${rc} — connection failure or a mid-run crash, not a SQL test result)"
      record "sql: $base" FAIL "psql did not run this file — see deploy log"
      continue
    fi
    section="$(printf '%s\n' "$output" | awk -v b="$begin_tag $base" -v e="$end_tag $base" \
      '$0==b{on=1;next} $0==e{on=0} on')"
    if printf '%s' "$section" | grep -q "SKIPPED-NO-PGTAP"; then
      skip=$((skip + 1))
      # Advisory: an absent prerequisite (pgtap not installed), not a test
      # result. See the function-level comment for why this stays a SKIP
      # forever and ensure_pgtap() is what escalates a persistent version
      # of this into a real deploy failure, not this line.
      record_advisory "sql: $base" SKIP "pgtap extension not installed on QA"
    elif printf '%s' "$section" | grep -qE "ERROR:|not ok [0-9]"; then
      fail=$((fail + 1))
      # Echo the failing lines. Without this the summary row says "see the
      # deploy log" and the log does not contain it — the section lives only
      # in $output, which is never printed. A check that reports a failure
      # you cannot diagnose is barely better than no check, and now that
      # this row blocks the deploy, the log IS what tells someone why.
      log "--- $base failed, first 20 offending lines:"
      printf '%s
' "$section" | grep -E "ERROR:|not ok [0-9]|EXCEPTION" | head -20 | sed 's/^/    /'
      # Blocking: record(), not record_advisory() — a real SQL test failure
      # must flip RESULT and fail this deploy. See the function-level
      # comment for why this is safe now (91/91 passing against QA today)
      # when it would not have been before pgtap existed on QA.
      record "sql: $base" FAIL "see the block above this table"
    else
      pass=$((pass + 1))
      record "sql: $base" ok ""
    fi
  done
  log "sql tests (blocking on FAIL, advisory on SKIP): pass=$pass fail=$fail skip=$skip"
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
  # MUST run before sql_tests_check(): that function decides per-pgTAP-file
  # whether to SKIP by querying pg_extension itself. Creating the extension
  # after it would leave this very deploy — the one that installs pgtap —
  # still reporting SKIPPED-NO-PGTAP for all 20 plan()/finish() files.
  ensure_pgtap
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
  # spec-93 fase 3 — the other RECREATABLE_QA_SERVICES, scoped to only the
  # ones whose OWN compose block actually changed. Must follow
  # sync_checkout/widen_changed_flags: it reads QA_PREV_SHA/QA_SYNCED_SHA,
  # the same #721-safe baseline those set.
  recreate_changed_qa_services "${QA_PREV_SHA:-}" "${QA_SYNCED_SHA:-${DEPLOY_SHA}}"
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
