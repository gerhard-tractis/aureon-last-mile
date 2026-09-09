#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-88 fase 4) — two ACL guardrails
# distilled from real bugs spec-88 found and fixed by hand:
#
#   Rule 4: WARN when a migration CREATEs/CREATE OR REPLACEs a function whose
#   signature does not match any REVOKE historically issued against a
#   same-named function with a DIFFERENT signature — the
#   start_pickup_route(text) bug (a REVOKE scoped to one overload never
#   covers a sibling overload).
#
#   Rule 5: REJECT when a migration CREATEs/CREATE OR REPLACEs a function and
#   GRANTs EXECUTE on it TO authenticated, but the migration contains NO
#   REVOKE statement at all — the close_manifest / add_dock_zone_adjacency_pair
#   bug (fase 1 of this same spec fixed four of these by hand;
#   20260913000004/spec-80 fase 1b fixed a fifth).
#
# Run: bash scripts/check-migration-safety-acl.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-migration-safety.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# write_file <dir> <filename-without-ext> — lets a single fixture directory
# hold MULTIPLE migration files, needed for rule 4 (the REVOKE and the new
# CREATE FUNCTION live in different files, exactly like the real corpus).
write_file() {
  mkdir -p "$TMP/$1"
  cat > "$TMP/$1/$2.sql"
}

assert_exit() {
  local expected="$1" name="$2" dir="$3" actual output
  output=$(bash "$SCRIPT" "$TMP/$dir" 2>&1)
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — expected exit $expected, got $actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

assert_contains() {
  local needle="$1" name="$2" dir="$3" output
  output=$(bash "$SCRIPT" "$TMP/$dir" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

assert_not_contains() {
  local needle="$1" name="$2" dir="$3" output
  output=$(bash "$SCRIPT" "$TMP/$dir" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    fail=$((fail + 1))
    echo "  FAIL $name — output unexpectedly contained: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  else
    pass=$((pass + 1))
    echo "  ok   $name"
  fi
}

echo "check-migration-safety.sh — rule 4 (orphaned overload REVOKE) and rule 5 (GRANT without REVOKE)"

# ── Rule 4: the real start_pickup_route(text)/start_pickup_route(uuid,
# uuid[]) bug — an earlier migration REVOKEs the 1-arg overload; a later
# migration CREATE OR REPLACEs the 2-arg overload. The REVOKE never covers
# the new signature.
write_file rule4-orphan-overload 0000000001_revoke_one_arg <<'SQL'
REVOKE ALL ON FUNCTION public.start_pickup_route(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_pickup_route(TEXT) FROM anon;
SQL
write_file rule4-orphan-overload 0000000002_new_two_arg_overload <<'SQL'
CREATE OR REPLACE FUNCTION public.start_pickup_route(
  p_vehicle_id UUID,
  p_crew_user_ids UUID[] DEFAULT '{}'::UUID[]
) RETURNS public.pickup_routes
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  RETURN NULL;
END;
$function$;
SQL
assert_exit 0 "rule 4: an orphaned-overload REVOKE only warns, never rejects" rule4-orphan-overload
assert_contains "::warning::" "rule 4: warns about the new 2-arg overload" rule4-orphan-overload
assert_contains "start_pickup_route" "rule 4: warning names the function" rule4-orphan-overload

# ── Rule 4 negative: the REVOKE already covers the EXACT signature being
# created — must not warn.
write_file rule4-exact-match-no-warn 0000000001_revoke_matching <<'SQL'
REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM anon;
SQL
write_file rule4-exact-match-no-warn 0000000002_replace_same_signature <<'SQL'
CREATE OR REPLACE FUNCTION public.close_manifest(
  p_manifest_id UUID,
  p_payload JSONB
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_not_contains "::warning::" "rule 4: an exact-signature match to an earlier REVOKE does not warn" rule4-exact-match-no-warn

# ── Rule 4 negative: no REVOKE history at all for this function name — rule
# 4 has nothing to compare against, so it stays silent (rule 5 is what
# governs a brand-new function).
write_file rule4-no-history-no-warn 0000000001_brand_new_function <<'SQL'
CREATE FUNCTION public.totally_new_rpc(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_not_contains "::warning::" "rule 4: a function with no REVOKE history at all does not warn" rule4-no-history-no-warn

# ── Rule 5: the exact close_manifest fase-1 bug (20260913000002) — CREATE
# OR REPLACE + GRANT EXECUTE ... TO authenticated, and NOT ONE REVOKE
# statement anywhere in the migration.
write_file rule5-grant-no-revoke-anywhere 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.close_manifest(
  p_manifest_id UUID,
  p_payload JSONB
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.close_manifest(UUID, JSONB) TO authenticated;
SQL
assert_exit 1 "rule 5: CREATE+GRANT TO authenticated with zero REVOKE in the file rejects" rule5-grant-no-revoke-anywhere
assert_contains "::error::" "rule 5: prints ::error::" rule5-grant-no-revoke-anywhere
assert_contains "close_manifest" "rule 5: error names the function" rule5-grant-no-revoke-anywhere

# ── Rule 5 negative: the correct pattern (spec-80 fase 1b) — REVOKE FROM
# PUBLIC, GRANT TO authenticated, REVOKE FROM anon, all in the same file —
# must not reject.
write_file rule5-correct-pattern-no-reject 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.close_manifest(
  p_manifest_id UUID,
  p_payload JSONB
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_manifest(UUID, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM anon;
SQL
assert_exit 0 "rule 5: the REVOKE/GRANT/REVOKE pattern does not reject" rule5-correct-pattern-no-reject
assert_not_contains "::error::" "rule 5: the correct pattern prints no error" rule5-correct-pattern-no-reject

# ── Rule 5 negative: GRANT TO service_role (not authenticated) is a
# different, legitimate pattern (e.g. calculate_daily_metrics) — must not
# reject even with zero REVOKE.
write_file rule5-grant-service-role-no-reject 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_cron_job()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.internal_cron_job() TO service_role;
SQL
assert_exit 0 "rule 5: GRANT TO service_role alone (no authenticated) does not reject" rule5-grant-service-role-no-reject

# ── Rule 5 negative: CREATE FUNCTION with no GRANT at all — must not reject
# (nothing here declares intent to expose it to authenticated).
write_file rule5-no-grant-no-reject 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 0 "rule 5: a CREATE FUNCTION with no GRANT at all does not reject" rule5-no-grant-no-reject

echo ""
echo "check-migration-safety.sh (rules 4/5): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
