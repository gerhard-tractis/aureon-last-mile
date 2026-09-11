#!/usr/bin/env bash
# measure-qa-surfaces.sh — spec-93 fase 4: QA's half of the parity guardrail,
# in the CANONICAL `surface<TAB>key<TAB>value` format that
# scripts/qa-prod-parity-compare.mjs reads.
#
# Runs ON the VPS itself (the `[self-hosted, vps]` runner — the same one
# deploy-qa/deploy-worker already use), so this is `docker inspect`/`docker
# exec` directly, no SSH. Reads the LIVE containers, never docker-compose.yml
# — fase 1 measured a case where the compose file and the running container
# had drifted for a month.
#
# WHITELIST BY KEY, NOT DENYLIST ON VALUE — review round 1, Bloqueante 1
# ---------------------------------------------------------------------
# `PGRST_DB_URI` is `postgres://authenticator:<QA's real postgres
# password>@...` — the literal string "password" never appears in that
# expanded value, so a denylist keyed on that substring let it straight
# through into a downloadable artifact. Every key this script emits is named
# explicitly in auth_alias/postgrest_alias (scripts/lib/qa-surface-aliases.sh,
# sourced below); anything not named there (PGRST_DB_URI, PGRST_JWT_SECRET,
# PGRST_APP_SETTINGS_JWT_SECRET, ...) is structurally never read, so there is
# no value to leak regardless of what it expands to.
#
# ALIASES TO PRODUCTION'S REAL NAMES — review round 1, Serio 5; corrected
# spec-93 fase 3b (run 34545563792 caught GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_
# ENABLED aliased to a key with a spurious "_hook_" that production never
# had)
# ---------------------------------------------------------------------
# QA's env vars are GOTRUE_<KEY>/PGRST_<KEY>; production's Management API
# uses different spellings for some of the same settings, confirmed against
# real production responses: PGRST_DB_SCHEMAS -> `db_schema` (singular),
# PGRST_DB_MAX_ROWS -> `max_rows` (no `db_` prefix). This script emits the
# PRODUCTION spelling so the two sides line up on the same key. Two settings
# (db_anon_role, db_use_legacy_gucs) keep a mechanical `PGRST_DB_*` -> `db_*`
# mapping that production's Management API does not expose under ANY name —
# confirmed against a real /v1/projects/{ref}/postgrest response (run
# 34539233402): it returns only db_extra_search_path, db_pool,
# db_pool_acquisition_timeout, db_schema, max_rows. Declared as accepted
# divergences in docs/qa-prod-parity-baseline.yml, not a mapping bug.
#
# A SURFACE FAILING TO READ DOES NOT ABORT THE OTHERS — same discipline as
# measure-prod-surfaces.sh: each surface is wrapped so a failure logs and the
# script keeps going. The comparator's completeness floor is what actually
# turns a missing surface into a red build.
#
# Never dumps a secret value.
set -uo pipefail

emit() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }
surface_failed() {
  echo "::warning::surface '$1' could not be measured against QA ($2) — continuing with the rest" >&2
}

container_env() {
  docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}'
}

# auth_alias/postgrest_alias live in scripts/lib/qa-surface-aliases.sh so
# they can be unit tested (scripts/lib/qa-surface-aliases.test.sh) without
# docker — see that file for the mapping notes and the review round 1
# provenance.
# shellcheck source=./lib/qa-surface-aliases.sh
source "$(dirname "$0")/lib/qa-surface-aliases.sh"

# ── auth (GoTrue) ────────────────────────────────────────────────────────
measure_auth() {
  container_env supabase-qa-auth | while IFS='=' read -r name value; do
    canonical="$(auth_alias "$name")" || continue
    emit auth "$canonical" "$value"
  done
}
measure_auth || surface_failed auth "docker inspect failed"

# ── PostgREST ────────────────────────────────────────────────────────────
measure_postgrest() {
  container_env supabase-qa-rest | while IFS='=' read -r name value; do
    canonical="$(postgrest_alias "$name")" || continue
    emit postgrest "$canonical" "$value"
  done
}
measure_postgrest || surface_failed postgrest "docker inspect failed"

# ── Edge functions deployed (directory listing) ─────────────────────────
# Normalized to "present" — same reasoning as measure-prod-surfaces.sh: a
# richer per-function comparison isn't a comparable fact between the two
# environments' available tooling today.
measure_edge_functions() {
  docker exec supabase-qa-edge-functions ls /home/deno/functions \
    | while IFS= read -r slug; do
        [ -n "$slug" ] || continue
        emit edge_function "$slug" present
      done
}
measure_edge_functions || surface_failed edge_function "docker exec failed"

# ── Kong routes — excluded_surfaces demonstration, not a prod comparison ─
# Production is the managed gateway, not Kong (docs/qa-prod-parity-baseline.yml
# excludes this surface with that reason). QA genuinely runs Kong, so this
# script still measures it — an excluded_surfaces entry that silences zero
# facts is decorative, not a real exclusion (review round 1, Menores). This
# is what lets the comparator report "excluded kong_routes, silenced N QA
# facts" instead of an entry nothing ever touches.
measure_kong_routes() {
  docker exec supabase-qa-kong grep -oE '/[a-z0-9._/-]+/v1[a-z0-9._/-]*' /usr/local/kong/kong.yml \
    | sort -u \
    | while IFS= read -r route; do
        [ -n "$route" ] || continue
        emit kong_routes "$route" present
      done
}
measure_kong_routes || surface_failed kong_routes "docker exec failed"

# ── Postgres extensions ──────────────────────────────────────────────────
measure_psql_surface() {
  local surface="$1" query="$2"
  docker exec supabase-qa-db psql -U postgres -At -c "$query" \
    | awk -F'\t' -v s="$surface" '{print s "\t" $1 "\t" $2}'
}

measure_psql_surface extensions \
  "SELECT extname||E'\t'||extversion FROM pg_extension ORDER BY 1;" \
  || surface_failed extensions "psql query failed"

# ── Roles and memberships ───────────────────────────────────────────────
measure_psql_surface roles "
  SELECT r.rolname||E'\t'||'memberof='||coalesce((
           SELECT string_agg(g.rolname, ',' ORDER BY g.rolname)
             FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
            WHERE m.member = r.oid), '-')
    FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\_%' ORDER BY 1;" \
  || surface_failed roles "psql query failed"

# ── GUCs (app.settings.*) — fila 8 del inventario de fase 1 ────────────
measure_gucs() {
  docker exec supabase-qa-db psql -U postgres -At -c \
    "SELECT unnest(setconfig) FROM pg_db_role_setting" \
    | while IFS= read -r setting; do
        name="${setting%%=*}"
        value="${setting#*=}"
        case "$name" in
          app.settings.jwt_secret) emit gucs "$name" "<redacted, presence only>" ;;
          app.settings.jwt_exp) emit gucs "$name" "$value" ;;
          *) : ;;
        esac
      done
}
measure_gucs || surface_failed gucs "psql query failed"

# ── cron.job ─────────────────────────────────────────────────────────────
measure_psql_surface cron_job "
  SELECT jobname||E'\t'||username||' | '||schedule||' | active='||active
    FROM cron.job ORDER BY jobid;" \
  || surface_failed cron_job "psql query failed"

# ── realtime publications (daily message partitions filtered in SQL) ────
measure_psql_surface realtime_publication "
  SELECT pubname||'.'||schemaname||'.'||tablename||E'\tpresent'
    FROM pg_publication_tables
   WHERE NOT (schemaname = 'realtime' AND tablename LIKE 'messages\_%')
   ORDER BY 1;" \
  || surface_failed realtime_publication "psql query failed"

# ── storage buckets ──────────────────────────────────────────────────────
measure_psql_surface storage_bucket "
  SELECT id||E'\t'||'public='||public||' limit='||coalesce(file_size_limit::text,'-')
         ||' mime='||coalesce(array_to_string(allowed_mime_types,','),'-')
    FROM storage.buckets ORDER BY id;" \
  || surface_failed storage_bucket "psql query failed"

# ── storage policies ─────────────────────────────────────────────────────
measure_psql_surface storage_policy "
  SELECT tablename||'.'||policyname||E'\t'||cmd||' roles='||array_to_string(roles,',')
    FROM pg_policies WHERE schemaname='storage' ORDER BY tablename, policyname;" \
  || surface_failed storage_policy "psql query failed"

exit 0
