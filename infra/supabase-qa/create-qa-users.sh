#!/usr/bin/env bash
# create-qa-users.sh — create one QA login user per app role (spec-48).
#
# Runs on the QA VPS after setup-qa.sh has applied migrations + seed-qa.sql.
# For every role in the user_role enum it POSTs to the GoTrue admin API
# (${QA_URL}/auth/v1/admin/users) with app_metadata {operator_id, role} at the
# TOP LEVEL — exactly what the handle_new_user trigger
# (20260216170542_create_users_table_with_rbac.sql) reads to auto-create the
# matching public.users row. A `claims` copy is included too, mirroring the
# shape used by 20260616000002_spec45_internal_operator_seed.sql.
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
# After each user exists, permissions are enforced via psql (localhost:5433)
# because handle_new_user leaves permissions = '{}'; the mapping matches the
# backfills in 20260310100001_add_permissions_to_users.sql and
# 20260324000003_add_dispatch_permission.sql.
#
# Idempotent: an existing email (GoTrue 422/409, or "already registered" body)
# is skipped cleanly; the permissions UPDATE is a no-op when already correct.
#
# Usage:
#   ./create-qa-users.sh [/path/to/.env.qa]     # default /home/aureon/.env.qa
#
# SAFETY: refuses to run if the derived API URL mentions supabase.co — QA user
# creation must never hit the production cloud project.

set -euo pipefail

ENV_FILE="${1:-/home/aureon/.env.qa}"
QA_PASSWORD='QaTest123!'
QA_OPERATOR_ID='00000000-0000-4000-8000-000000000001'   # seed-qa.sql
INTERNAL_OPERATOR_ID='00000000-0000-0000-0000-0000000000a1'  # 20260616000002

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

SERVICE_ROLE_KEY="$(env_get SERVICE_ROLE_KEY)"
SUPABASE_URL="$(env_get SUPABASE_URL)"
[ -n "$SUPABASE_URL" ] || SUPABASE_URL="$(env_get SUPABASE_PUBLIC_URL)"
DB_PASSWORD="$(env_get SUPABASE_DB_PASSWORD)"
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(env_get POSTGRES_PASSWORD)"
DB_PORT="$(env_get SUPABASE_DB_PORT)"
[ -n "$DB_PORT" ] || DB_PORT=5433

if [ -z "$SERVICE_ROLE_KEY" ] || [[ "$SERVICE_ROLE_KEY" == CHANGE_ME* ]]; then
  echo "ERROR: SERVICE_ROLE_KEY missing or placeholder in $ENV_FILE" >&2
  exit 1
fi
if [ -z "$SUPABASE_URL" ]; then
  echo "ERROR: SUPABASE_URL / SUPABASE_PUBLIC_URL missing in $ENV_FILE" >&2
  exit 1
fi
if [ -z "$DB_PASSWORD" ] || [[ "$DB_PASSWORD" == CHANGE_ME* ]]; then
  echo "ERROR: SUPABASE_DB_PASSWORD / POSTGRES_PASSWORD missing or placeholder in $ENV_FILE" >&2
  exit 1
fi

# --- Production guard --------------------------------------------------------
case "$SUPABASE_URL" in
  *supabase.co*)
    echo "REFUSING to run: $SUPABASE_URL points at supabase.co (production cloud)." >&2
    echo "QA user creation only targets the self-hosted QA stack (localhost Kong)." >&2
    exit 1
    ;;
esac
QA_URL="${SUPABASE_URL%/}"

psql_qa() {
  PGPASSWORD="$DB_PASSWORD" psql -h localhost -p "$DB_PORT" -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt "$@"
}

# --- Role table: role|operator_id|permissions (comma-separated) --------------
ROLE_ROWS="pickup_crew|$QA_OPERATOR_ID|pickup
warehouse_staff|$QA_OPERATOR_ID|warehouse
loading_crew|$QA_OPERATOR_ID|loading,dispatch
operations_manager|$QA_OPERATOR_ID|operations,dispatch
admin|$QA_OPERATOR_ID|pickup,warehouse,loading,operations,admin,dispatch
super_admin|$INTERNAL_OPERATOR_ID|pickup,warehouse,loading,operations,admin,dispatch"

CREATED=()
SKIPPED=()
FAILED=()

create_user() {
  local role="$1" operator_id="$2" email="$3"
  local body http_code response
  body=$(cat <<JSON
{
  "email": "$email",
  "password": "$QA_PASSWORD",
  "email_confirm": true,
  "app_metadata": {
    "operator_id": "$operator_id",
    "role": "$role",
    "claims": { "operator_id": "$operator_id", "role": "$role" }
  },
  "user_metadata": { "full_name": "QA ${role} user" }
}
JSON
)
  response=$(curl -sS -o /tmp/qa-user-resp.$$ -w '%{http_code}' \
    -X POST "$QA_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$body") || { FAILED+=("$email (curl error)"); return 1; }
  http_code="$response"

  case "$http_code" in
    200|201)
      CREATED+=("$email")
      ;;
    409|422)
      SKIPPED+=("$email (already exists, HTTP $http_code)")
      ;;
    400)
      if grep -qi "already" /tmp/qa-user-resp.$$; then
        SKIPPED+=("$email (already exists)")
      else
        echo "ERROR creating $email (HTTP 400): $(cat /tmp/qa-user-resp.$$)" >&2
        FAILED+=("$email (HTTP 400)")
      fi
      ;;
    *)
      echo "ERROR creating $email (HTTP $http_code): $(cat /tmp/qa-user-resp.$$)" >&2
      FAILED+=("$email (HTTP $http_code)")
      ;;
  esac
  rm -f /tmp/qa-user-resp.$$
  return 0
}

enforce_permissions() {
  # handle_new_user inserts permissions='{}'; enforce the role mapping from
  # 20260310100001 + 20260324000003. Idempotent (plain UPDATE to a constant).
  local role="$1" email="$2" perms="$3"
  local pg_array="{$perms}"
  psql_qa -c "UPDATE public.users
                 SET permissions = '$pg_array'::text[]
               WHERE email = '$email' AND role = '$role' AND deleted_at IS NULL;" \
    || { FAILED+=("$email (permissions update failed)"); return 1; }
  return 0
}

echo "QA user creation against $QA_URL (env: $ENV_FILE)"
echo

while IFS='|' read -r role operator_id perms; do
  [ -n "$role" ] || continue
  email="qa-${role//_/-}@qa.test"
  echo "-- $role -> $email (operator $operator_id)"
  create_user "$role" "$operator_id" "$email" || true
  enforce_permissions "$role" "$email" "$perms" || true
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
