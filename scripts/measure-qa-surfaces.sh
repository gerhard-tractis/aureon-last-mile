#!/usr/bin/env bash
# measure-qa-surfaces.sh — spec-93 fase 4: QA's half of the parity guardrail,
# in the CANONICAL `surface<TAB>key<TAB>value` format that
# scripts/qa-prod-parity-compare.mjs reads.
#
# Runs ON the VPS itself (this is the `[self-hosted, vps]` runner — the same
# one deploy-qa and deploy-worker already use), so this is `docker
# inspect`/`docker exec` directly, no SSH. Reads the LIVE containers, never
# docker-compose.yml — spec-93 fase 1 measured a case where the compose file
# and the running container had drifted for a month; a script that read the
# YAML instead of the container would have missed exactly that.
#
# KEY NAMING — the one assumption this script makes that the comparator
# cannot verify on its own: GoTrue and PostgREST env vars are GOTRUE_<KEY>
# and PGRST_<KEY> respectively; production's Management API exposes the same
# settings as lowercase JSON keys without that prefix (e.g.
# GOTRUE_DISABLE_SIGNUP -> disable_signup, PGRST_DB_MAX_ROWS -> db_max_rows).
# This mapping is NOT independently confirmed against a live production
# response as part of this phase — if it is wrong for a given key, the
# comparator will report a spurious "undeclared divergence" (a false
# positive, safe direction) rather than silently matching the wrong things.
# Confirming/correcting the mapping against real prod output is fase 3/5
# work, not fase 4's.
#
# Never dumps a secret value: the same whitelist-then-denylist discipline as
# measure-prod-surfaces.yml / measure-prod-surfaces.sh.
set -euo pipefail

emit() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }

container_env() {
  docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}'
}

# ── auth (GoTrue) ────────────────────────────────────────────────────────
container_env supabase-qa-auth \
  | grep -iE '^GOTRUE_(HOOK|EXTERNAL_|JWT_EXP|DISABLE_SIGNUP|MAILER_AUTOCONFIRM|MFA_|REFRESH_TOKEN_)' \
  | grep -viE 'secret|password|client_id|_token=' \
  | while IFS='=' read -r name value; do
      key="$(printf '%s' "${name#GOTRUE_}" | tr '[:upper:]' '[:lower:]')"
      emit auth "$key" "$value"
    done

# ── PostgREST ────────────────────────────────────────────────────────────
docker inspect supabase-qa-rest --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -iE '^PGRST_' \
  | grep -viE 'secret|password|jwt' \
  | while IFS='=' read -r name value; do
      key="$(printf '%s' "${name#PGRST_}" | tr '[:upper:]' '[:lower:]')"
      emit postgrest "$key" "$value"
    done

# ── Edge functions deployed (directory listing, not the API) ───────────
docker exec supabase-qa-edge-functions ls /home/deno/functions \
  | while read -r slug; do
      [ -n "$slug" ] && emit edge_function "$slug" "present"
    done

# ── Postgres extensions ──────────────────────────────────────────────────
docker exec supabase-qa-db psql -U postgres -At -c \
  "SELECT extname||E'\t'||extversion FROM pg_extension ORDER BY 1;" \
  | awk -F'\t' '{print "extensions\t" $1 "\t" $2}'

# ── Roles and memberships ───────────────────────────────────────────────
docker exec supabase-qa-db psql -U postgres -At -c "
  SELECT r.rolname||E'\t'||'memberof='||coalesce((
           SELECT string_agg(g.rolname, ',' ORDER BY g.rolname)
             FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
            WHERE m.member = r.oid), '-')
    FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\_%' ORDER BY 1;" \
  | awk -F'\t' '{print "roles\t" $1 "\t" $2}'

# ── cron.job ─────────────────────────────────────────────────────────────
docker exec supabase-qa-db psql -U postgres -At -c "
  SELECT jobname||E'\t'||username||' | '||schedule||' | active='||active
    FROM cron.job ORDER BY jobid;" \
  | awk -F'\t' '{print "cron_job\t" $1 "\t" $2}'

# ── realtime publications (excluding the daily message partitions) ─────
docker exec supabase-qa-db psql -U postgres -At -c "
  SELECT pubname||'.'||schemaname||'.'||tablename||E'\tpresent'
    FROM pg_publication_tables
   WHERE NOT (schemaname = 'realtime' AND tablename LIKE 'messages\_%')
   ORDER BY 1;" \
  | awk -F'\t' '{print "realtime_publication\t" $1 "\t" $2}'

# ── storage buckets ──────────────────────────────────────────────────────
docker exec supabase-qa-db psql -U postgres -At -c "
  SELECT id||E'\t'||'public='||public||' limit='||coalesce(file_size_limit::text,'-')
         ||' mime='||coalesce(array_to_string(allowed_mime_types,','),'-')
    FROM storage.buckets ORDER BY id;" \
  | awk -F'\t' '{print "storage_bucket\t" $1 "\t" $2}'

# ── storage policies ─────────────────────────────────────────────────────
docker exec supabase-qa-db psql -U postgres -At -c "
  SELECT tablename||'.'||policyname||E'\t'||cmd||' roles='||array_to_string(roles,',')
    FROM pg_policies WHERE schemaname='storage' ORDER BY tablename, policyname;" \
  | awk -F'\t' '{print "storage_policy\t" $1 "\t" $2}'
