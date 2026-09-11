#!/usr/bin/env bash
# measure-prod-surfaces.sh — spec-93 fase 4: production's half of the parity
# guardrail, in the CANONICAL `surface<TAB>key<TAB>value` format that
# scripts/qa-prod-parity-compare.mjs reads.
#
# Sibling of .github/workflows/measure-prod-surfaces.yml (spec-93 fase 1),
# not a replacement — that workflow prints a human-readable step summary and
# stays untouched. This asks the SAME questions but writes canonical lines
# instead of prose, because the comparator needs a stable line format.
#
# WHITELIST BY KEY, NOT DENYLIST ON VALUE — review round 1 finding
# ---------------------------------------------------------------------
# Every key this script can possibly emit is named explicitly below (see
# AUTH_KEYS / POSTGREST_KEYS). Nothing outside that list is ever read out of
# the JSON responses, so there is no value to accidentally leak — this is
# what closed the actual leak this review round found: `PGRST_DB_URI`
# contains `postgres://authenticator:<password>@...`, and the word "password"
# never appears in that expanded string, so a denylist keyed on the SUBSTRING
# "password" let it straight through. A whitelist keyed on the field NAME
# can't make that mistake, because `db_uri` (or `PGRST_DB_URI`) is simply
# never in the list.
#
# ALIASES — review round 1 finding (Serio 5)
# ---------------------------------------------------------------------
# QA's env-var names and production's Management API JSON keys are NOT the
# same strings for every setting, even after stripping the GOTRUE_/PGRST_
# prefix and lowercasing. Two confirmed by hand against a real production
# response: `PGRST_DB_SCHEMAS` -> Management API `db_schema` (singular), and
# `PGRST_DB_MAX_ROWS` -> Management API `max_rows` (no `db_` prefix at all).
# Both sides now emit the PRODUCTION spelling as the canonical key —
# scripts/measure-qa-surfaces.sh aliases to match. Where the real production
# name for a setting has not been independently confirmed (db_anon_role,
# db_use_legacy_gucs), this script keeps the best-guess mechanical mapping
# and says so; a wrong guess here produces a spurious UNDECLARED divergence
# (safe direction — visible and loud), never a silent false match.
#
# A SURFACE FAILING TO READ DOES NOT ABORT THE OTHERS
# ---------------------------------------------------------------------
# main's own #758 fix (measure-prod-surfaces.yml) exists because a single
# 404 used to take down all eight surfaces behind it under `set -e`. This
# script is one process, not eight workflow steps, so the same discipline is
# a function per surface, each wrapped so a failure logs a ::warning:: and
# the SCRIPT KEEPS GOING — never let one broken surface hide the other
# seven. The completeness floor lives in the comparator
# (qa-prod-parity-compare.mjs), which refuses to pass if an expected surface
# produced zero facts from either side — that is what actually turns a
# silently-dropped surface into a red build, not this script aborting.
#
# Not unit-tested: talks to real production credentials and the real
# Supabase Management API. The comparator it feeds is deliberately free of
# both, and that is what gets tested (see qa-prod-parity-compare.test.mjs).
set -uo pipefail

: "${SUPABASE_ACCESS_TOKEN:?missing}"
: "${SUPABASE_PROJECT_REF:?missing}"
: "${SUPABASE_DB_PASSWORD:?missing}"
: "${POOLER_HOST:?missing}"

# Puerto y usuario se LEEN del connection_string que resuelve el workflow, no
# se suponen: el usuario del pooler es `postgres.<ref>` y el puerto de modo
# transaccion 6543, pero darlos por hechos es la clase de error que dejo las
# siete superficies via psql a cero en la corrida 34544230110.
: "${POOLER_PORT:?missing}"
: "${POOLER_USER:?missing}"
PSQL_CONN="sslmode=require host=$POOLER_HOST port=$POOLER_PORT dbname=postgres user=$POOLER_USER"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

# Canonical auth keys this guardrail tracks today. Expanding this list is a
# deliberate, explicit edit (fase 3/5 work) — not something a prefix regex
# should ever do implicitly, because prod's /config/auth carries dozens of
# fields QA never declares (mailer_secure_email_change_enabled,
# external_google_enabled, ...), and a regex that matched all of them would
# be permanent, unfixable noise (review round 1, Serio 5).
AUTH_KEYS="disable_signup mailer_autoconfirm jwt_exp hook_custom_access_token_hook_enabled external_email_enabled external_phone_enabled external_anonymous_users_enabled mfa_totp_enroll_enabled mfa_totp_verify_enabled refresh_token_rotation_enabled"
POSTGREST_KEYS="db_schema max_rows db_extra_search_path db_anon_role db_use_legacy_gucs"

surface_failed() {
  echo "::warning::surface '$1' could not be measured against production ($2) — continuing with the rest" >&2
}

# ── auth (GoTrue) ────────────────────────────────────────────────────────
measure_auth() {
  local tmp status
  tmp="$(mktemp)"
  status=$(curl -sS -o "$tmp" -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth")
  if [ "$status" != "200" ]; then rm -f "$tmp"; return 1; fi
  for key in $AUTH_KEYS; do
    jq -er --arg k "$key" 'if has($k) then ($k + "\t" + (.[$k] | tostring)) else empty end' "$tmp" \
      | while IFS=$'\t' read -r k v; do printf 'auth\t%s\t%s\n' "$k" "$v"; done
  done
  rm -f "$tmp"
}
measure_auth || surface_failed auth "HTTP or parse error against /config/auth"

# ── PostgREST ────────────────────────────────────────────────────────────
# Endpoint is /v1/projects/{ref}/postgrest, NOT /config/postgrest — the
# latter 404s (main #758). Auth genuinely lives under /config/auth; the two
# are not symmetric, and assuming they were cost a whole run once already.
measure_postgrest() {
  local tmp status
  tmp="$(mktemp)"
  status=$(curl -sS -o "$tmp" -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/postgrest")
  if [ "$status" != "200" ]; then rm -f "$tmp"; return 1; fi
  for key in $POSTGREST_KEYS; do
    jq -er --arg k "$key" 'if has($k) then ($k + "\t" + (.[$k] | tostring)) else empty end' "$tmp" \
      | while IFS=$'\t' read -r k v; do printf 'postgrest\t%s\t%s\n' "$k" "$v"; done
  done
  rm -f "$tmp"
}
measure_postgrest || surface_failed postgrest "HTTP or parse error against /postgrest"

# ── Edge functions deployed ─────────────────────────────────────────────
# Normalized to the same "present" value QA emits — the Management API's
# status/verify_jwt shape and QA's directory listing are not the same kind
# of fact, and comparing them as strings would diverge forever regardless of
# real drift (review round 1, Serio 5). Slug presence is the comparable
# common denominator; richer per-function comparison is future work.
measure_edge_functions() {
  local tmp status
  tmp="$(mktemp)"
  status=$(curl -sS -o "$tmp" -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/functions")
  if [ "$status" != "200" ]; then rm -f "$tmp"; return 1; fi
  jq -er '.[] | select(.status == "ACTIVE") | .slug' "$tmp" \
    | while IFS= read -r slug; do printf 'edge_function\t%s\tpresent\n' "$slug"; done
  rm -f "$tmp"
}
measure_edge_functions || surface_failed edge_function "HTTP or parse error against /functions"

# ── Postgres extensions ──────────────────────────────────────────────────
measure_psql_surface() {
  local surface="$1" query="$2"
  psql "$PSQL_CONN" -At -c "$query" | awk -F'\t' -v s="$surface" '{print s "\t" $1 "\t" $2}'
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
# Secret-shaped GUCs (anything with "secret" in the name) report only
# whether they exist, never their value — same discipline as
# measure-prod-surfaces.yml's redaction of *jwt_secret*.
measure_gucs() {
  psql "$PSQL_CONN" -At -c "
    SELECT unnest(setconfig)
      FROM pg_db_role_setting" \
    | while IFS= read -r setting; do
        name="${setting%%=*}"
        value="${setting#*=}"
        case "$name" in
          app.settings.jwt_secret) printf 'gucs\t%s\t<redacted, presence only>\n' "$name" ;;
          app.settings.jwt_exp) printf 'gucs\t%s\t%s\n' "$name" "$value" ;;
          *) : ;; # not on the tracked list — see AUTH_KEYS-style comment above
        esac
      done
}
measure_gucs || surface_failed gucs "psql query failed"

# ── cron.job ─────────────────────────────────────────────────────────────
measure_psql_surface cron_job "
  SELECT jobname||E'\t'||username||' | '||schedule||' | active='||active
    FROM cron.job ORDER BY jobid;" \
  || surface_failed cron_job "psql query failed"

# ── realtime publications ───────────────────────────────────────────────
# realtime.messages_* daily partitions are filtered HERE, in SQL, on both
# sides — not via the baseline's excluded_surfaces (a partition row's
# SURFACE is still "realtime_publication", same as every other row; a
# surface-level exclusion can't selectively drop just these rows, so it
# would be decorative, not a real filter — review round 1, Menores).
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
