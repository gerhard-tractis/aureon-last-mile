#!/usr/bin/env bash
#
# Tests for scripts/lib/qa-surface-aliases.sh (spec-93 fase 3b).
# Run: bash scripts/lib/qa-surface-aliases.test.sh
#
# Pure function tests — no docker, no credentials. Regression test for run
# 34545563792: GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED aliased to
# hook_custom_access_token_hook_enabled (spurious "_hook_"), which does not
# exist in production's /config/auth response, so the comparator reported
# an UNDECLARED divergence for a setting where QA and production actually
# agree.
#
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./qa-surface-aliases.sh
source "$SELF_DIR/qa-surface-aliases.sh"

pass=0
fail=0

# assert_alias <fn> <input> <expected output> <test name>
assert_alias() {
  local fn="$1" input="$2" expected="$3" name="$4" actual
  actual="$("$fn" "$input" 2>/dev/null)" || actual="<error>"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — expected '$expected', got '$actual'"
  fi
}

# assert_alias_fails <fn> <input> <test name>
assert_alias_fails() {
  local fn="$1" input="$2" name="$3"
  if "$fn" "$input" >/dev/null 2>&1; then
    fail=$((fail + 1))
    echo "  FAIL $name — expected non-zero exit, got success"
  else
    pass=$((pass + 1))
    echo "  ok   $name"
  fi
}

echo "qa-surface-aliases.sh"

assert_alias auth_alias GOTRUE_DISABLE_SIGNUP disable_signup "auth_alias maps GOTRUE_DISABLE_SIGNUP"
assert_alias auth_alias GOTRUE_MAILER_AUTOCONFIRM mailer_autoconfirm "auth_alias maps GOTRUE_MAILER_AUTOCONFIRM"
assert_alias auth_alias GOTRUE_JWT_EXP jwt_exp "auth_alias maps GOTRUE_JWT_EXP"
assert_alias auth_alias GOTRUE_EXTERNAL_EMAIL_ENABLED external_email_enabled "auth_alias maps GOTRUE_EXTERNAL_EMAIL_ENABLED"
assert_alias auth_alias GOTRUE_EXTERNAL_PHONE_ENABLED external_phone_enabled "auth_alias maps GOTRUE_EXTERNAL_PHONE_ENABLED"
assert_alias auth_alias GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED external_anonymous_users_enabled "auth_alias maps GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED"
assert_alias_fails auth_alias GOTRUE_SOMETHING_UNKNOWN "auth_alias rejects an unmapped key"

# The regression: production's real key is hook_custom_access_token_enabled
# (confirmed against run 34545563792's undeclared-divergence report), NOT
# hook_custom_access_token_hook_enabled.
assert_alias auth_alias GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED hook_custom_access_token_enabled \
  "auth_alias maps GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED to production's real key (no spurious _hook_)"

assert_alias postgrest_alias PGRST_DB_SCHEMAS db_schema "postgrest_alias maps PGRST_DB_SCHEMAS"
assert_alias postgrest_alias PGRST_DB_MAX_ROWS max_rows "postgrest_alias maps PGRST_DB_MAX_ROWS"
assert_alias postgrest_alias PGRST_DB_EXTRA_SEARCH_PATH db_extra_search_path "postgrest_alias maps PGRST_DB_EXTRA_SEARCH_PATH"
assert_alias postgrest_alias PGRST_DB_ANON_ROLE db_anon_role "postgrest_alias maps PGRST_DB_ANON_ROLE"
assert_alias postgrest_alias PGRST_DB_USE_LEGACY_GUCS db_use_legacy_gucs "postgrest_alias maps PGRST_DB_USE_LEGACY_GUCS"
assert_alias_fails postgrest_alias PGRST_DB_SOMETHING_UNKNOWN "postgrest_alias rejects an unmapped key"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
