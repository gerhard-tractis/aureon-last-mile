#!/usr/bin/env bash
# qa-surface-aliases.sh — spec-93 fase 3b: the QA-env-var -> production-key
# alias tables, pulled out of measure-qa-surfaces.sh so they can be unit
# tested (scripts/lib/qa-surface-aliases.test.sh) without touching docker.
#
# Sourced by measure-qa-surfaces.sh. Not executable on its own — no `exit`,
# no side effects, just function definitions.
#
# QA's env-var names and production's Management API JSON keys are NOT the
# same strings for every setting, even after stripping the GOTRUE_/PGRST_
# prefix and lowercasing. Confirmed against real production responses:
# `PGRST_DB_SCHEMAS` -> `db_schema` (singular), `PGRST_DB_MAX_ROWS` ->
# `max_rows` (no `db_` prefix), `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED` ->
# `hook_custom_access_token_enabled` (NOT `..._hook_enabled` — that
# spurious "_hook_" was a mechanical mistake in the original alias, caught
# by qa-prod-parity.yml run 34545563792 reporting it as an UNDECLARED
# divergence instead of a match). Where the real production name for a
# setting has not been independently confirmed (db_anon_role,
# db_use_legacy_gucs), this keeps the best-guess mechanical mapping and says
# so in a comment — a wrong guess here produces a spurious UNDECLARED
# divergence (safe direction — visible and loud), never a silent false
# match.
auth_alias() {
  case "$1" in
    GOTRUE_DISABLE_SIGNUP) echo disable_signup ;;
    GOTRUE_MAILER_AUTOCONFIRM) echo mailer_autoconfirm ;;
    GOTRUE_JWT_EXP) echo jwt_exp ;;
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED) echo hook_custom_access_token_enabled ;;
    GOTRUE_EXTERNAL_EMAIL_ENABLED) echo external_email_enabled ;;
    GOTRUE_EXTERNAL_PHONE_ENABLED) echo external_phone_enabled ;;
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED) echo external_anonymous_users_enabled ;;
    *) return 1 ;;
  esac
}

postgrest_alias() {
  case "$1" in
    PGRST_DB_SCHEMAS) echo db_schema ;;          # prod: singular, confirmed
    PGRST_DB_MAX_ROWS) echo max_rows ;;          # prod: no db_ prefix, confirmed
    PGRST_DB_EXTRA_SEARCH_PATH) echo db_extra_search_path ;; # confirmed as-is
    PGRST_DB_ANON_ROLE) echo db_anon_role ;;     # best guess, unconfirmed
    PGRST_DB_USE_LEGACY_GUCS) echo db_use_legacy_gucs ;; # best guess, unconfirmed
    *) return 1 ;;
  esac
}
