#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-88 fase 4) — two ACL guardrails
# distilled from real bugs spec-88 found and fixed by hand:
#
#   Rule 4: WARN when a migration CREATEs/CREATE OR REPLACEs a SECURITY
#   DEFINER function whose signature does not match any REVOKE historically
#   issued against a same-named function with a DIFFERENT signature — the
#   start_pickup_route(text) bug (a REVOKE scoped to one overload never
#   covers a sibling overload).
#
#   Rule 5: REJECT when a migration CREATEs/CREATE OR REPLACEs a SECURITY
#   DEFINER function with no REVOKE (ALL or EXECUTE) ... FROM PUBLIC for
#   that EXACT signature anywhere in the same migration. Redesigned in
#   review round 2 (PR #723) after B1 proved, against the live database,
#   that GRANT presence/absence is irrelevant: Postgres grants EXECUTE to
#   PUBLIC on every newly (re)created function by default, whether or not
#   the migration ever writes a GRANT statement — so the only thing that
#   actually closes the exposure is a REVOKE targeting PUBLIC, for that
#   exact function, in that exact migration. SECURITY INVOKER functions are
#   out of scope: they run with the CALLER's own privileges, so `anon`
#   being able to call one is not a privilege escalation.
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

echo "check-migration-safety.sh — rule 4 (orphaned overload REVOKE) and rule 5 (SECURITY DEFINER without REVOKE FROM PUBLIC)"

# ── Rule 4: the general shape of the start_pickup_route(text)/
# start_pickup_route(uuid, uuid[]) bug — a same-named sibling overload has a
# REVOKE, this one has none of its own, anywhere. Under the rule 5 redesign
# (B1) this ALSO rejects — a SECURITY DEFINER function with zero REVOKE for
# its own signature fails rule 5 regardless of rule 4 — so both fire
# together here, which is the honest, current behavior: rule 4 adds the
# diagnostic ("there IS a REVOKE, just for a different signature") on top
# of rule 5's blunt "you have zero REVOKE at all".
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
assert_exit 1 "rule 4: an orphaned-overload REVOKE warns AND rule 5 rejects (no REVOKE of its own)" rule4-orphan-overload
assert_contains "an earlier REVOKE exists" "rule 4: warns about the new 2-arg overload" rule4-orphan-overload
assert_contains "start_pickup_route" "rule 4: warning names the function" rule4-orphan-overload

# ── Rule 4 negative: the REVOKE already covers the EXACT signature being
# created (any role — rule 4 only cares about signature identity, not
# role-completeness; role-completeness is rule 5's job) — must not warn.
# This fixture ALSO carries its own REVOKE ... FROM PUBLIC so rule 5 does
# not reject, keeping this test isolated to rule 4's behavior.
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

REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM PUBLIC;
SQL
assert_exit 0 "rule 4: an exact-signature match to an earlier REVOKE, with its own REVOKE FROM PUBLIC too, does not reject" rule4-exact-match-no-warn
assert_not_contains "an earlier REVOKE exists" "rule 4: an exact-signature match to an earlier REVOKE does not warn" rule4-exact-match-no-warn

# ── Rule 4 negative: no REVOKE history at all for this function name — rule
# 4 has nothing to compare against, so it stays silent. Rule 5 still
# rejects this fixture (fresh SECURITY DEFINER, zero REVOKE anywhere for
# itself) — the two assertions below isolate rule 4's OWN silence from
# rule 5's independent rejection.
write_file rule4-no-history-no-warn 0000000001_brand_new_function <<'SQL'
CREATE FUNCTION public.totally_new_rpc(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "rule 4 stays silent, but rule 5 independently rejects (zero REVOKE for a fresh SECURITY DEFINER function)" rule4-no-history-no-warn
assert_not_contains "an earlier REVOKE exists" "rule 4: a function with no REVOKE history at all does not warn" rule4-no-history-no-warn

echo ""
echo "-- rule 5 (redesigned, review round 2, B1/B2/B3) --"

# ── B1: a fresh CREATE (no GRANT anywhere, no REVOKE anywhere) on a
# SECURITY DEFINER function used to be treated as safe. It is not — Postgres
# grants EXECUTE to PUBLIC on every new function by default, GRANT statement
# or not (proved against the live DB by the reviewer, round 2).
write_file b1-no-grant-no-revoke-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "B1: SECURITY DEFINER + zero GRANT + zero REVOKE rejects (default PUBLIC grant)" b1-no-grant-no-revoke-rejects
assert_contains "internal_helper" "B1: error names the function" b1-no-grant-no-revoke-rejects

# ── B1 corollary: GRANT to service_role ALONE does not close the default
# PUBLIC grant either — still rejects.
write_file b1-grant-service-role-only-rejects 0000000001_fixture <<'SQL'
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
assert_exit 1 "B1 corollary: GRANT TO service_role alone does not close the default PUBLIC grant — still rejects" b1-grant-service-role-only-rejects

# ── SECURITY INVOKER is out of scope: it runs with the CALLER's own
# privileges, so anon being able to call it is not a privilege escalation.
write_file security-invoker-out-of-scope 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.pure_helper(p_x INT) RETURNS INT
LANGUAGE sql SECURITY INVOKER
AS $function$
  SELECT p_x + 1;
$function$;
SQL
assert_exit 0 "SECURITY INVOKER (not DEFINER) is out of scope for rule 5" security-invoker-out-of-scope

# ── The correct pattern (spec-80 fase 1b): REVOKE FROM PUBLIC closes it,
# regardless of what else is granted afterwards.
write_file correct-pattern-revoke-public 0000000001_fixture <<'SQL'
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
assert_exit 0 "correct pattern: REVOKE ... FROM PUBLIC for the exact signature does not reject" correct-pattern-revoke-public

# ── REVOKE FROM PUBLIC alone, no GRANT anywhere, is sufficient — GRANT is
# irrelevant to this rule after the B1 redesign.
write_file revoke-public-no-grant-needed 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
assert_exit 0 "REVOKE FROM PUBLIC alone (no GRANT at all) does not reject" revoke-public-no-grant-needed

# ── B1's original bug, restated as the "ACL that lies" pattern: REVOKE FROM
# anon ONLY (no PUBLIC) leaves the default PUBLIC grant standing — rejects.
write_file revoke-anon-only-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.add_dock_zone_adjacency_pair(p_a UUID, p_b UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_dock_zone_adjacency_pair(UUID, UUID) FROM anon;
SQL
assert_exit 1 "REVOKE FROM anon only (no FROM PUBLIC) rejects — the ACL-that-lies pattern" revoke-anon-only-rejects

# ── B2: a REVOKE on a DIFFERENT, unrelated function in the same file must
# not silence the rule for a function that has no REVOKE of its own — the
# old `hasAnyRevoke` was file-global, not per-function.
write_file b2-per-function-revoke 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.safe_fn(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.evil_fn(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.safe_fn(UUID) FROM PUBLIC;
SQL
assert_exit 1 "B2: a REVOKE on one function does not silence the rule for a sibling function in the same file" b2-per-function-revoke
assert_contains "evil_fn" "B2: error names the function that actually lacks its own REVOKE" b2-per-function-revoke
assert_not_contains "public.safe_fn" "B2: does not also flag the function that DOES have its own REVOKE" b2-per-function-revoke

# ── A commented-out REVOKE must not count — same failure mode as B2 (a
# REVOKE-shaped string present in the file silencing the rule) via a
# different door: stripLineComments must run before the REVOKE scan.
write_file commented-revoke-does-not-count 0000000001_fixture <<'SQL'
-- REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "a commented-out REVOKE does not count — still rejects" commented-revoke-does-not-count

# ── Medium: REVOKE EXECUTE (not REVOKE ALL) FROM PUBLIC is an equally valid
# way to close the default grant — must not reject.
write_file revoke-execute-not-all 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
assert_exit 0 "REVOKE EXECUTE (not REVOKE ALL) FROM PUBLIC also closes it" revoke-execute-not-all

# ── B3-adjacent: PUBLIC named in a multi-role FROM list, not alone, must
# still count as revoking PUBLIC.
write_file revoke-public-in-role-list 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM anon, PUBLIC;
SQL
assert_exit 0 "REVOKE ... FROM anon, PUBLIC (PUBLIC not first) still counts as revoking PUBLIC" revoke-public-in-role-list

# ── Misleading-message fix: when ONLY rule 5 fires, the rule-1 backfill
# message must not print (nothing here mixes DDL with a backfill).
write_file acl-only-message 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_not_contains "unbounded top-level backfill" "an ACL-only rejection does not print the rule-1 backfill message" acl-only-message

echo ""
echo "-- --base scoping (review round 2: the suite never exercised --base, the only mode CI uses) --"

# ── Rule 4 must still see a REVOKE that lives in a migration NOT touched by
# the PR (the historical corpus), not just the files in the diff.
GIT_FIXTURE="$TMP/gitrepo-rule4-base"
mkdir -p "$GIT_FIXTURE/migrations"
(
  cd "$GIT_FIXTURE"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_revoke_one_arg.sql <<'SQL'
REVOKE ALL ON FUNCTION public.start_pickup_route(TEXT) FROM PUBLIC;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000002_new_two_arg_overload.sql <<'SQL'
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
  git add -A
  git commit -q -m "add new overload"
)
BASE_SHA=$(cd "$GIT_FIXTURE" && git rev-parse HEAD~1)
output=$(cd "$GIT_FIXTURE" && bash "$SCRIPT" --base "$BASE_SHA" migrations 2>&1)
if printf '%s' "$output" | grep -q "an earlier REVOKE exists"; then
  pass=$((pass + 1))
  echo "  ok   --base: rule 4 sees a REVOKE from a migration the PR did not touch"
else
  fail=$((fail + 1))
  echo "  FAIL --base: rule 4 did not warn — the historical REVOKE (outside the diff) was not seen"
  printf '%s\n' "$output" | sed 's/^/         /'
fi

# ── Rule 5 under --base: a newly ADDED migration with the B1 bug must still
# reject when invoked the way CI actually invokes this script.
GIT_FIXTURE2="$TMP/gitrepo-rule5-base"
mkdir -p "$GIT_FIXTURE2/migrations"
(
  cd "$GIT_FIXTURE2"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_unrelated.sql <<'SQL'
ALTER TABLE public.packages ADD COLUMN foo TEXT;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000002_new_bug.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "add function with the B1 bug"
)
BASE_SHA2=$(cd "$GIT_FIXTURE2" && git rev-parse HEAD~1)
output2=$(cd "$GIT_FIXTURE2" && bash "$SCRIPT" --base "$BASE_SHA2" migrations 2>&1)
actual2=$?
if [ "$actual2" -eq 1 ]; then
  pass=$((pass + 1))
  echo "  ok   --base: rule 5 rejects a newly added migration with the B1 bug"
else
  fail=$((fail + 1))
  echo "  FAIL --base: rule 5 did not reject — expected exit 1, got $actual2"
  printf '%s\n' "$output2" | sed 's/^/         /'
fi

echo ""
echo "check-migration-safety.sh (rules 4/5): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
