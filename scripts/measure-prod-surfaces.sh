#!/usr/bin/env bash
# measure-prod-surfaces.sh — spec-93 fase 4: production's half of the parity
# guardrail, in the CANONICAL `surface<TAB>key<TAB>value` format that
# scripts/qa-prod-parity-compare.mjs reads.
#
# This is a sibling of .github/workflows/measure-prod-surfaces.yml (spec-93
# fase 1), not a replacement for it — that workflow prints a human-readable
# step summary and stays untouched (another fase depends on it existing as
# it is). This script asks the SAME questions (same psql queries, same
# Management API endpoints, same whitelist/redaction discipline) but writes
# machine-comparable lines instead of a formatted summary, because the
# comparator needs a stable line format, not prose.
#
# Run from a workflow only — needs SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
# SUPABASE_DB_PASSWORD and a resolved POOLER_HOST in the environment. Not
# unit-tested: it talks to real production credentials and the real Supabase
# Management API, which the comparator it feeds is deliberately free of (see
# qa-prod-parity-compare.mjs's header) so THAT can be tested without either.
#
# Never dumps a secret value — same two-layer discipline as
# measure-prod-surfaces.yml: a whitelist of prefixes, and on top of that a
# denylist of anything that smells like a secret.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?missing}"
: "${SUPABASE_PROJECT_REF:?missing}"
: "${SUPABASE_DB_PASSWORD:?missing}"
: "${POOLER_HOST:?missing}"

PSQL_CONN="sslmode=require host=$POOLER_HOST port=6543 dbname=postgres user=postgres.${SUPABASE_PROJECT_REF}"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

emit() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }

# ── auth (GoTrue) ────────────────────────────────────────────────────────
# Same whitelist regex as measure-prod-surfaces.yml's auth step, minus the
# ones that are inherently secret-shaped even after the prefix matches
# (client_id, *_token$) — those never made it into a canonical key here.
auth_json="$(curl -sS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth")"
echo "$auth_json" | jq -r '
  to_entries
  | map(select(.key | test("^(hook_|external_|jwt_exp|disable_signup|mailer_autoconfirm|mfa_|refresh_token_)")))
  | map(select(.key | test("secret|password|client_id|_token$"; "i") | not))
  | .[] | "auth\t" + .key + "\t" + (.value | tostring)'

# ── PostgREST ────────────────────────────────────────────────────────────
rest_json="$(curl -sS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/postgrest")"
echo "$rest_json" | jq -r '
  to_entries | map(select(.key | test("secret|password|jwt"; "i") | not))
  | .[] | "postgrest\t" + .key + "\t" + (.value | tostring)'

# ── Edge functions deployed ─────────────────────────────────────────────
fns_json="$(curl -sS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/functions")"
echo "$fns_json" | jq -r '.[] | "edge_function\t" + .slug + "\tstatus=" + .status + " verify_jwt=" + (.verify_jwt|tostring)'

# ── Postgres extensions ──────────────────────────────────────────────────
psql "$PSQL_CONN" -At -c "SELECT extname||'\t'||extversion FROM pg_extension ORDER BY 1;" \
  | awk -F'\t' '{print "extensions\t" $1 "\t" $2}'

# ── Roles and memberships ───────────────────────────────────────────────
psql "$PSQL_CONN" -At -c "
  SELECT r.rolname||'\t'||'memberof='||coalesce((
           SELECT string_agg(g.rolname, ',' ORDER BY g.rolname)
             FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
            WHERE m.member = r.oid), '-')
    FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\_%' ORDER BY 1;" \
  | awk -F'\t' '{print "roles\t" $1 "\t" $2}'

# ── cron.job ─────────────────────────────────────────────────────────────
psql "$PSQL_CONN" -At -c "
  SELECT jobname||'\t'||username||' | '||schedule||' | active='||active
    FROM cron.job ORDER BY jobid;" \
  | awk -F'\t' '{print "cron_job\t" $1 "\t" $2}'

# ── realtime publications (excluding the daily message partitions) ─────
psql "$PSQL_CONN" -At -c "
  SELECT pubname||'.'||schemaname||'.'||tablename||'\tpresent'
    FROM pg_publication_tables
   WHERE NOT (schemaname = 'realtime' AND tablename LIKE 'messages\_%')
   ORDER BY 1;" \
  | awk -F'\t' '{print "realtime_publication\t" $1 "\t" $2}'

# ── storage buckets ──────────────────────────────────────────────────────
psql "$PSQL_CONN" -At -c "
  SELECT id||'\t'||'public='||public||' limit='||coalesce(file_size_limit::text,'-')
         ||' mime='||coalesce(array_to_string(allowed_mime_types,','),'-')
    FROM storage.buckets ORDER BY id;" \
  | awk -F'\t' '{print "storage_bucket\t" $1 "\t" $2}'

# ── storage policies ─────────────────────────────────────────────────────
psql "$PSQL_CONN" -At -c "
  SELECT tablename||'.'||policyname||'\t'||cmd||' roles='||array_to_string(roles,',')
    FROM pg_policies WHERE schemaname='storage' ORDER BY tablename, policyname;" \
  | awk -F'\t' '{print "storage_policy\t" $1 "\t" $2}'
