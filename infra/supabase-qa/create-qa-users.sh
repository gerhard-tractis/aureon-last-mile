#!/usr/bin/env bash
# create-qa-users.sh — create one QA login user per app role (spec-48).
#
# Runs on the QA VPS after setup-qa.sh has applied migrations + seed-qa.sql.
# Users are created via DIRECT SQL against the QA Postgres (localhost:5433),
# NOT the GoTrue admin API: GoTrue v2.189.0 INSERTs the auth.users row BEFORE
# applying app_metadata, so the handle_new_user trigger
# (20260216170542_create_users_table_with_rbac.sql) fires with no operator_id
# and aborts with "operator_id required in signup metadata". Inserting the row
# ourselves with raw_app_meta_data already populated (same shape migration
# 20260616000002_spec45_internal_operator_seed.sql uses) lets the trigger
# create the matching public.users row, and a companion auth.identities row
# (provider 'email') makes password login work on GoTrue v2.
#
# Roles (derived from the user_role enum: 20260216170542 + super_admin added
# by 20260616000001_spec45_user_role_super_admin.sql):
#   pickup_crew, warehouse_staff, loading_crew, operations_manager, admin
#     -> bound to the QA operator seeded by seed-qa.sql
#        (00000000-0000-4000-8000-000000000001)
#   super_admin
#     -> bound to the internal Aureon operator seeded by migration
#        20260616000002 (00000000-0000-0000-0000-0000000000a1), per spec-45:
#        "Super-admin humans ... with operator_id = the internal operator".
#
# After each user exists, permissions are enforced via UPDATE ... RETURNING
# because handle_new_user leaves permissions = '{}'; the mapping matches the
# backfills in 20260310100001_add_permissions_to_users.sql and
# 20260324000003_add_dispatch_permission.sql.
#
# Idempotent: an email already present in auth.users is skipped cleanly; the
# permissions UPDATE is a no-op when already correct.
#
# Usage:
#   ./create-qa-users.sh [/path/to/.env.qa]     # default /home/aureon/.env.qa
#
# SAFETY: refuses to run if any non-comment value in the env file mentions
# supabase.co — QA user creation must never touch the production cloud
# project. The DB connection itself is pinned to localhost.

set -euo pipefail

ENV_FILE="${1:-/home/aureon/.env.qa}"
QA_PASSWORD='QaTest123!'
QA_OPERATOR_ID='00000000-0000-4000-8000-000000000001'   # seed-qa.sql
INTERNAL_OPERATOR_ID='00000000-0000-0000-0000-0000000000a1'  # 20260616000002
GOTRUE_INSTANCE_ID='00000000-0000-0000-0000-000000000000'

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  echo "Usage: $0 [/path/to/.env.qa]" >&2
  exit 1
fi

# --- Parse the env file (grep, not source: avoid executing anything) --------
env_get() {
  # Last occurrence wins, strip CR, take value after first '='.
  # `|| true` so a missing key yields "" instead of tripping set -e.
  { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r'
}

DB_PASSWORD="$(env_get SUPABASE_DB_PASSWORD)"
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(env_get POSTGRES_PASSWORD)"
DB_PORT="$(env_get SUPABASE_DB_PORT)"
[ -n "$DB_PORT" ] || DB_PORT=5433

if [ -z "$DB_PASSWORD" ] || [[ "$DB_PASSWORD" == CHANGE_ME* ]]; then
  echo "ERROR: SUPABASE_DB_PASSWORD / POSTGRES_PASSWORD missing or placeholder in $ENV_FILE" >&2
  exit 1
fi

# --- Production guard --------------------------------------------------------
# Value-only scan: any non-comment line mentioning supabase.co means this env
# file points at the production cloud project — refuse outright.
if grep -Eq '^[^#]*supabase\.co' "$ENV_FILE"; then
  echo "REFUSING to run: $ENV_FILE references supabase.co (production cloud)." >&2
  echo "QA user creation only targets the self-hosted QA stack (localhost)." >&2
  exit 1
fi

psql_qa() {
  PGPASSWORD="$DB_PASSWORD" psql -h localhost -p "$DB_PORT" -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt "$@"
}

# --- Locate pgcrypto (crypt/gen_salt) — schema varies by image --------------
PGCRYPTO_SCHEMA=$(psql_qa -c "SELECT n.nspname FROM pg_extension e
                              JOIN pg_namespace n ON n.oid = e.extnamespace
                              WHERE e.extname = 'pgcrypto';") || {
  echo "ERROR: cannot query QA Postgres on localhost:$DB_PORT" >&2
  exit 1
}
if [ -z "$PGCRYPTO_SCHEMA" ]; then
  echo "ERROR: pgcrypto extension not installed in the QA database" >&2
  exit 1
fi

# --- Role table: role|operator_id|permissions (comma-separated) --------------
# Fixed UUIDs so re-runs and QA scripts can reference the users directly.
ROLE_ROWS="pickup_crew|$QA_OPERATOR_ID|pickup|00000000-0000-4000-8000-000000000201
warehouse_staff|$QA_OPERATOR_ID|warehouse|00000000-0000-4000-8000-000000000202
loading_crew|$QA_OPERATOR_ID|loading,dispatch|00000000-0000-4000-8000-000000000203
operations_manager|$QA_OPERATOR_ID|operations,dispatch|00000000-0000-4000-8000-000000000204
admin|$QA_OPERATOR_ID|pickup,warehouse,loading,operations,admin,dispatch|00000000-0000-4000-8000-000000000205
super_admin|$INTERNAL_OPERATOR_ID|pickup,warehouse,loading,operations,admin,dispatch|00000000-0000-4000-8000-000000000206"

CREATED=()
SKIPPED=()
FAILED=()

user_exists() { # $1 = email; prints 't' when present
  psql_qa -v email="$1" -f - <<'SQL'
SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = :'email');
SQL
}

create_user() {
  local role="$1" operator_id="$2" email="$3" uid="$4"
  local exists
  exists=$(user_exists "$email") || { FAILED+=("$email (existence check failed)"); return 1; }
  if [ "$exists" = "t" ]; then
    SKIPPED+=("$email (already exists)")
    return 0
  fi

  # One transaction (-1): auth.users insert (fires handle_new_user, which
  # creates public.users) + auth.identities row for GoTrue v2 email login.
  # NOTE: psql :'var' interpolation only works via stdin/-f, not -c.
  # Empty-string (not NULL) token columns avoid GoTrue's NULL-scan errors.
  if psql_qa -1 \
      -v uid="$uid" -v email="$email" -v urole="$role" \
      -v operator_id="$operator_id" -v pw="$QA_PASSWORD" \
      -v instance_id="$GOTRUE_INSTANCE_ID" \
      -v cryptschema="$PGCRYPTO_SCHEMA" \
      -f - <<'SQL'
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current
) VALUES (
  :'uid', :'instance_id', 'authenticated', 'authenticated', :'email',
  :"cryptschema".crypt(:'pw', :"cryptschema".gen_salt('bf', 10)),
  now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'operator_id', :'operator_id',
    'role', :'urole',
    'claims', jsonb_build_object('operator_id', :'operator_id', 'role', :'urole')
  ),
  jsonb_build_object('full_name', 'QA ' || :'urole' || ' user'),
  now(), now(), '', '', '', '', ''
);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(), :'uid',
  jsonb_build_object(
    'sub', :'uid'::text,
    'email', :'email',
    'email_verified', true,
    'phone_verified', false
  ),
  'email', :'uid'::text,
  now(), now(), now()
);
SQL
  then
    CREATED+=("$email")
    return 0
  else
    echo "ERROR: SQL insert failed for $email ($role)" >&2
    FAILED+=("$email (SQL insert failed)")
    return 1
  fi
}

enforce_permissions() {
  # handle_new_user inserts permissions='{}'; enforce the role mapping from
  # 20260310100001 + 20260324000003. Idempotent (plain UPDATE to a constant).
  local role="$1" email="$2" perms="$3"
  local pg_array="{$perms}" updated
  updated=$(psql_qa -v email="$email" -v urole="$role" -v perms="$pg_array" -f - <<'SQL'
UPDATE public.users
   SET permissions = :'perms'::text[]
 WHERE email = :'email' AND role = :'urole'::user_role AND deleted_at IS NULL
RETURNING id;
SQL
  ) || { FAILED+=("$email (permissions update failed)"); return 1; }
  if [ -z "$updated" ]; then
    echo "ERROR: permissions update matched no public.users row for $email ($role)" >&2
    echo "       (handle_new_user trigger did not create the row?)" >&2
    FAILED+=("$email (no public.users row to update)")
    return 1
  fi
  return 0
}

echo "QA user creation via direct SQL on localhost:$DB_PORT (env: $ENV_FILE)"
echo "pgcrypto schema: $PGCRYPTO_SCHEMA"
echo

while IFS='|' read -r role operator_id perms uid; do
  [ -n "$role" ] || continue
  email="qa-${role//_/-}@qa.test"
  echo "-- $role -> $email (operator $operator_id)"
  if create_user "$role" "$operator_id" "$email" "$uid"; then
    enforce_permissions "$role" "$email" "$perms" || true
  fi
done <<< "$ROLE_ROWS"

echo
echo "==============================================================="
echo " QA users summary"
echo "==============================================================="
echo " Password for ALL QA users: $QA_PASSWORD"
echo
echo " Created (${#CREATED[@]}):"
for u in ${CREATED[@]+"${CREATED[@]}"}; do echo "   - $u"; done
echo " Skipped (${#SKIPPED[@]}):"
for u in ${SKIPPED[@]+"${SKIPPED[@]}"}; do echo "   - $u"; done
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo " FAILED (${#FAILED[@]}):"
  for u in "${FAILED[@]}"; do echo "   - $u"; done
  exit 1
fi
echo "==============================================================="
