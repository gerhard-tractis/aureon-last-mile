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
echo "-- round 3 (review adversarial against the live database, PR #723) --"

# ── B1 (round 3): CREATE OR REPLACE PRESERVES the ACL — it does NOT reset to
# the default PUBLIC grant. Measured against the live database (ROLLBACK):
# a REVOKE FROM PUBLIC in an EARLIER migration, with no GRANT TO PUBLIC
# since, stays closed across a later CREATE OR REPLACE that touches no ACL
# at all — exactly 20260913000008 (spec-88 fase 2)'s own pattern, which
# that migration's own assertion (:169-175) proves against the live DB.
write_file b1-hardened-earlier-stays-closed 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.assert_operator_access(p_operator_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_operator_access(UUID) FROM PUBLIC;
SQL
write_file b1-hardened-earlier-stays-closed 0000000002_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.assert_operator_access(p_operator_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 0 "B1 (round 3): a CREATE OR REPLACE of an already-hardened function, with no ACL statements of its own, does not reject" b1-hardened-earlier-stays-closed

# ── B2 (round 3, the CI-red bug): a trigger function (RETURNS TRIGGER) is
# never directly invocable via PostgREST/RPC the way an ordinary RPC is —
# fase 0 of this spec explicitly excluded trigger functions from the
# invocable-functions count. Real precedent: 20261001000001 (spec-86),
# whose own comment says "no REVOKE/GRANT needed" for exactly this reason.
write_file b2-trigger-function-out-of-scope 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.trg_advance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
SQL
assert_exit 0 "round 3: a RETURNS TRIGGER function is out of scope for rule 5 (real CI-red precedent: 20261001000001)" b2-trigger-function-out-of-scope
assert_not_contains "an earlier REVOKE exists" "round 3: a RETURNS TRIGGER function is out of scope for rule 4 too" b2-trigger-function-out-of-scope

# ── Rule 4's own trigger exclusion, tested where it can actually fire: an
# earlier REVOKE for a DIFFERENT signature of the same name exists (the
# shape rule 4 warns about), and the trigger function being (re)created
# must stay silent anyway — the fixture above never reaches rule 4's
# trigger check at all (no REVOKE history exists for that name), so it
# cannot catch a mutant that drops the trigger filter from rule 4.
write_file rule4-trigger-exclusion-with-history 0000000001_revoke_other_signature <<'SQL'
REVOKE ALL ON FUNCTION public.trg_advance_status(TEXT) FROM PUBLIC;
SQL
write_file rule4-trigger-exclusion-with-history 0000000002_trigger_zero_arg <<'SQL'
CREATE OR REPLACE FUNCTION public.trg_advance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
SQL
assert_not_contains "an earlier REVOKE exists" "rule 4's trigger exclusion holds even when REVOKE history for the name exists" rule4-trigger-exclusion-with-history

# ── Point 4a (round 3): REVOKE FROM PUBLIC followed by GRANT TO PUBLIC (same
# file, that order) undoes the REVOKE — measured against the live database:
# anon_exec becomes true again. The rule must reflect the LAST ACL
# statement's effect, not "does a REVOKE exist anywhere in the file".
write_file point4a-grant-public-after-revoke-reopens 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_helper() TO PUBLIC;
SQL
assert_exit 1 "point 4a (round 3): REVOKE FROM PUBLIC then GRANT TO PUBLIC reopens it — rejects" point4a-grant-public-after-revoke-reopens

# ── Point 4b (round 3): a schema-wide GRANT ... ON ALL FUNCTIONS IN SCHEMA
# reopens PUBLIC for every function it covers, even ones it never names —
# a later CREATE OR REPLACE with no ACL statements of its own must still
# reject, because the cumulative corpus state is open.
write_file point4b-schema-wide-grant-reopens 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file point4b-schema-wide-grant-reopens 0000000002_schema_wide_grant <<'SQL'
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;
SQL
write_file point4b-schema-wide-grant-reopens 0000000003_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "point 4b (round 3): a schema-wide GRANT ... ON ALL FUNCTIONS IN SCHEMA reopens PUBLIC — the later CREATE OR REPLACE rejects" point4b-schema-wide-grant-reopens

# ── Menor (round 3): REVOKE ... FROM PUBLIC CASCADE — CASCADE is a trailing
# keyword, not a role name. splitRoleList must not turn PUBLIC into the
# literal string "public cascade".
write_file cascade-keyword-not-a-role 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC CASCADE;
SQL
assert_exit 0 "menor (round 3): REVOKE ... FROM PUBLIC CASCADE still counts as revoking PUBLIC" cascade-keyword-not-a-role

# ── Menor (round 3): REVOKE ON FUNCTION with NO argument list at all is
# legal in PG14+ when the function name is unambiguous — must not be
# invisible to the parser (which would falsely leave the function looking
# never-revoked).
write_file revoke-no-arg-list 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper FROM PUBLIC;
SQL
assert_exit 0 "menor (round 3): REVOKE ON FUNCTION with no argument list still counts (PG14+, unambiguous name)" revoke-no-arg-list

# ── B2 coverage gap (round 3): a REVOKE covering ONE overload of a name
# must not be mistaken for covering a DIFFERENT overload of the SAME name —
# kills the mutant that drops the `r.signature === fn.signature` check.
write_file b2-coverage-different-overload-same-name 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.overloaded_fn(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.overloaded_fn(p_id UUID, p_extra TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.overloaded_fn(UUID) FROM PUBLIC;
SQL
assert_exit 1 "B2 coverage (round 3): a REVOKE on one overload does not cover a DIFFERENT overload of the same name" b2-coverage-different-overload-same-name
assert_contains "overloaded_fn(uuid,text)" "B2 coverage: error names the uncovered 2-arg overload" b2-coverage-different-overload-same-name

# ── SECURITY DEFINER window-bound coverage (round 3): a SECURITY INVOKER
# function whose BODY happens to contain the literal string "SECURITY
# DEFINER" (not a comment — comments are already stripped project-wide)
# must not be misread as SECURITY DEFINER — kills the mutant that
# unbounds the option-clause search window into the function body.
write_file security-definer-window-bound 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.pure_helper() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
AS $function$
BEGIN
  RAISE EXCEPTION 'this operation requires SECURITY DEFINER privilege, which this function does not have';
END;
$function$;
SQL
assert_exit 0 "window-bound (round 3): SECURITY DEFINER text inside the BODY of an INVOKER function does not count" security-definer-window-bound
assert_not_contains "an earlier REVOKE exists" "window-bound: rule 4 also does not misread the body text" security-definer-window-bound

# ── Timeline direction (round 3): a GRANT ... TO PUBLIC that reopens a
# function must NOT affect files that come chronologically BEFORE it — a
# migration's ACL state depends only on what has already applied by the
# time it runs, never on the future. Three files: #1 hardens (CREATE +
# REVOKE FROM PUBLIC), #2 replaces with no ACL touch of its own (must stay
# closed — the future reopening in #3 must not leak backward), #3 reopens.
write_file timeline-future-events-do-not-leak-backward 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file timeline-future-events-do-not-leak-backward 0000000002_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
write_file timeline-future-events-do-not-leak-backward 0000000003_reopen_later <<'SQL'
GRANT EXECUTE ON FUNCTION public.internal_helper() TO PUBLIC;
SQL
output=$(bash "$SCRIPT" "$TMP/timeline-future-events-do-not-leak-backward" 2>&1 || true)
if printf '%s' "$output" | grep "::error::" | grep -q "0000000002_replace_no_acl_touch"; then
  fail=$((fail + 1))
  echo "  FAIL timeline direction: file #2 was flagged even though it stays closed as of its own position — a later GRANT leaked backward"
  printf '%s\n' "$output" | sed 's/^/         /'
else
  pass=$((pass + 1))
  echo "  ok   timeline direction: a later GRANT ... TO PUBLIC (file #3) does not leak backward onto file #2, which stays closed as of its own position"
fi

echo ""
echo "-- round 4 (post-merge follow-up, PR #723 rebase): two false negatives found by review --"

# ── DROP FUNCTION resets the ACL — CREATE OR REPLACE preserves it (round 3),
# but a DROP destroys the function object entirely, and Postgres's default
# EXECUTE-to-PUBLIC grant applies fresh to whatever CREATE follows. A
# migration that REVOKEs, then later DROPs and recreates the same function
# with no REVOKE of its own, is open again — the timeline must not keep
# treating the earlier REVOKE as still in effect across the DROP.
write_file drop-then-create-reopens 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file drop-then-create-reopens 0000000002_drop_and_recreate <<'SQL'
DROP FUNCTION public.internal_helper();

CREATE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "round 4: DROP FUNCTION + CREATE FUNCTION reopens PUBLIC even though an earlier REVOKE existed — rejects" drop-then-create-reopens

# ── DROP FUNCTION with no argument list (bare, unambiguous name — legal
# PG14+, same convention as the existing REVOKE-without-parens support) must
# still be recognized as a reset, not silently ignored by the parser.
write_file drop-bare-no-args-reopens 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file drop-bare-no-args-reopens 0000000002_drop_bare_and_recreate <<'SQL'
DROP FUNCTION public.internal_helper;

CREATE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "round 4: a bare (no-parens) DROP FUNCTION also reopens — the reset is not invisible to the parser" drop-bare-no-args-reopens

# ── DROP FUNCTION on a DIFFERENT signature of the same name must not reset
# an unrelated overload — kills a mutant that resets by name alone.
write_file drop-different-overload-does-not-reset-sibling 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.overloaded_fn(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.overloaded_fn(UUID) FROM PUBLIC;
SQL
write_file drop-different-overload-does-not-reset-sibling 0000000002_drop_other_overload <<'SQL'
DROP FUNCTION public.overloaded_fn(TEXT);
SQL
write_file drop-different-overload-does-not-reset-sibling 0000000003_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.overloaded_fn(p_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 0 "round 4: a DROP of a DIFFERENT overload does not reset this one's REVOKE" drop-different-overload-does-not-reset-sibling

# ── Direct GRANT ... TO anon, with no PUBLIC involved at all, opens access
# for anon regardless of PUBLIC's own (closed) state — anon does not need
# PUBLIC's inherited grant when it has its own explicit one.
write_file grant-to-anon-directly-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_helper() TO anon;
SQL
assert_exit 1 "round 4: a direct GRANT ... TO anon rejects even though PUBLIC itself is closed" grant-to-anon-directly-rejects

# ── Negative: PUBLIC closed and no explicit anon grant at all — must not
# reject (regression guard against an over-eager anon check).
write_file no-anon-grant-stays-closed 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_helper() TO authenticated;
SQL
assert_exit 0 "round 4: GRANT TO authenticated (not anon) alongside a closed PUBLIC does not reject" no-anon-grant-stays-closed

# ── DROP FUNCTION also resets a previously-explicit anon grant, not just
# PUBLIC — file #1 is correctly flagged on its own (it opens anon directly
# with no REVOKE undoing it), but file #2, which DROPs+recreates and closes
# PUBLIC properly with no new anon grant, must NOT be independently flagged
# for an anon exposure that no longer exists after the DROP.
write_file drop-resets-prior-anon-grant-too 0000000001_open_via_anon <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_helper() TO anon;
SQL
write_file drop-resets-prior-anon-grant-too 0000000002_drop_recreate_properly_closed <<'SQL'
DROP FUNCTION public.internal_helper();

CREATE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
output=$(bash "$SCRIPT" "$TMP/drop-resets-prior-anon-grant-too" 2>&1 || true)
if printf '%s' "$output" | grep "::error::" | grep -q "0000000002_drop_recreate_properly_closed"; then
  fail=$((fail + 1))
  echo "  FAIL round 4: DROP also resets a prior explicit anon grant — file #2 was flagged even though it re-closes properly after the DROP"
  printf '%s\n' "$output" | sed 's/^/         /'
else
  pass=$((pass + 1))
  echo "  ok   round 4: DROP also resets a prior explicit anon grant — file #2 (properly re-closed after the DROP) is not flagged, even though file #1 alone correctly is"
fi

echo ""
echo "-- round 5 (PR #723 review, B1-B4: two more direct-anon shapes, one more DROP shape, one untested branch) --"

# ── B1: a QUOTED role name ("anon") is what `supabase db diff` actually
# emits (real precedent: 20250130181641_todo_list.sql:23, `to "anon"`) —
# splitRoleList lower-cased but never stripped the quotes, so `"anon"` never
# matched the literal `'anon'` check.
write_file b1-quoted-anon-role-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_helper() TO "anon";
SQL
assert_exit 1 "B1: GRANT ... TO \"anon\" (quoted, the supabase db diff form) rejects same as unquoted" b1-quoted-anon-role-rejects

# ── B2: GRANT ALL (not just GRANT EXECUTE) ON FUNCTION ... TO anon must be
# seen — REVOKE already accepted ALL|EXECUTE symmetrically; GRANT_HEADER_RE
# only accepted EXECUTE, which is the wrong side to be strict on (the OPEN
# side, not the CLOSE side).
write_file b2-grant-all-to-anon-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT ALL ON FUNCTION public.internal_helper() TO anon;
SQL
assert_exit 1 "B2: GRANT ALL (not GRANT EXECUTE) ON FUNCTION ... TO anon rejects" b2-grant-all-to-anon-rejects

write_file b2-grant-all-privileges-to-anon-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT ALL PRIVILEGES ON FUNCTION public.internal_helper() TO anon;
SQL
assert_exit 1 "B2: GRANT ALL PRIVILEGES ON FUNCTION ... TO anon rejects" b2-grant-all-privileges-to-anon-rejects

# ── B3: a schema-wide grant that names `anon` (not `PUBLIC`) opens every
# SECURITY DEFINER function it covers to anon directly, in one statement —
# the round-3 schema-wide tracking only ever checked for PUBLIC in the role
# list, never anon.
write_file b3-schema-wide-grant-to-anon-rejects 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file b3-schema-wide-grant-to-anon-rejects 0000000002_schema_wide_grant_to_anon <<'SQL'
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
SQL
write_file b3-schema-wide-grant-to-anon-rejects 0000000003_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "B3: a schema-wide GRANT ... TO anon reopens every function it covers, even PUBLIC-closed ones" b3-schema-wide-grant-to-anon-rejects

# ── B4: the wildcard branch of isAnonOpenDirectly — a bare (no-parens)
# GRANT ... TO anon reference, PG14+, unambiguous name — was never exercised
# by any existing test; this is the case that specifically needs it.
write_file b4-bare-grant-to-anon-wildcard-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_helper TO anon;
SQL
assert_exit 1 "B4: a bare (no-parens) GRANT ... TO anon reference rejects — exercises isAnonOpenDirectly's wildcard branch" b4-bare-grant-to-anon-wildcard-rejects

echo ""
echo "-- B10 (review round 5, decision): rule 5 degrades under --base same as rule 1 --"

# ── A violation that ALREADY existed at base, on a file this PR merely
# TOUCHES (without fixing the ACL), must WARN, not reject — otherwise any
# PR editing one of the corpus's 35+ pre-existing offenders fails CI for a
# problem it did not introduce (the "check disables itself in a week"
# scenario B10 exists to prevent).
GIT_FIXTURE3="$TMP/gitrepo-rule5-base-preexisting"
mkdir -p "$GIT_FIXTURE3/migrations"
(
  cd "$GIT_FIXTURE3"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_already_open.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000001_already_open.sql <<'SQL'
-- touched by this PR for an unrelated reason, ACL still not closed
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "touch file for an unrelated reason"
)
BASE_SHA3=$(cd "$GIT_FIXTURE3" && git rev-parse HEAD~1)
output3=$(cd "$GIT_FIXTURE3" && bash "$SCRIPT" --base "$BASE_SHA3" migrations 2>&1)
actual3=$?
if [ "$actual3" -eq 0 ] && printf '%s' "$output3" | grep -q "::warning::.*already present before this PR"; then
  pass=$((pass + 1))
  echo "  ok   B10: a pre-existing rule-5 violation on a touched (not fixed) file degrades to a warning, does not reject"
else
  fail=$((fail + 1))
  echo "  FAIL B10: pre-existing rule-5 violation did not degrade — expected exit 0 with a degradation warning, got exit $actual3"
  printf '%s\n' "$output3" | sed 's/^/         /'
fi

# ── A violation this PR genuinely INTRODUCES — the file was properly
# closed at base, and this PR's edit removes the REVOKE — must still
# reject. Degradation must not become a blanket exemption for every edit.
GIT_FIXTURE4="$TMP/gitrepo-rule5-base-newly-introduced"
mkdir -p "$GIT_FIXTURE4/migrations"
(
  cd "$GIT_FIXTURE4"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_properly_closed.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000001_properly_closed.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "PR removes the REVOKE — this is the bug"
)
BASE_SHA4=$(cd "$GIT_FIXTURE4" && git rev-parse HEAD~1)
output4=$(cd "$GIT_FIXTURE4" && bash "$SCRIPT" --base "$BASE_SHA4" migrations 2>&1)
actual4=$?
if [ "$actual4" -eq 1 ] && printf '%s' "$output4" | grep -q "::error::.*internal_helper"; then
  pass=$((pass + 1))
  echo "  ok   B10: a violation genuinely introduced by this PR's edit (REVOKE removed) still rejects, even under --base"
else
  fail=$((fail + 1))
  echo "  FAIL B10: a newly-introduced rule-5 violation did not reject — expected exit 1 with an ::error::, got exit $actual4"
  printf '%s\n' "$output4" | sed 's/^/         /'
fi

# ── B10 cross-file: an ADDED file must contribute NOTHING to baseTimeline —
# it did not exist at base. A file lexically ordered BEFORE it that is only
# TOUCHED (not fixed) must still read as "was already open at base", i.e.
# degrade — not have its baseline state polluted by the added file's
# CURRENT (post-PR) content leaking backward into "state at base".
GIT_FIXTURE5="$TMP/gitrepo-rule5-base-added-does-not-pollute"
mkdir -p "$GIT_FIXTURE5/migrations"
(
  cd "$GIT_FIXTURE5"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_open_fn.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.shared_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000000_inserted_before.sql <<'SQL'
REVOKE ALL ON FUNCTION public.shared_fn() FROM PUBLIC;
SQL
  cat > migrations/0000000001_open_fn.sql <<'SQL'
-- touched by this PR for an unrelated reason, still open
CREATE OR REPLACE FUNCTION public.shared_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "add an earlier-sorting file with its own REVOKE, and touch the open one"
)
BASE_SHA5=$(cd "$GIT_FIXTURE5" && git rev-parse HEAD~1)
output5=$(cd "$GIT_FIXTURE5" && bash "$SCRIPT" --base "$BASE_SHA5" migrations 2>&1)
if printf '%s' "$output5" | grep -q "::error::.*0000000001_open_fn.sql"; then
  fail=$((fail + 1))
  echo "  FAIL B10 cross-file: the added file's CURRENT content leaked into baseTimeline, wrongly rejecting a pre-existing violation"
  printf '%s\n' "$output5" | sed 's/^/         /'
else
  pass=$((pass + 1))
  echo "  ok   B10 cross-file: an added file contributes nothing to baseTimeline — the touched file's pre-existing violation still degrades"
fi

# ── B8: a `DROP FUNCTION` mentioned inside another function's dollar-quoted
# BODY (e.g. a code-generation helper that emits SQL text, or a comment
# preserved inside a string literal) must not count as a real reset — the
# body never runs at migration-apply time on its own. findCreateFunctionSignatures
# already bounds its option-clause scan to outside function bodies (round 3,
# the window-bound test); findDropFunctionSignatures needs the same
# treatment.
write_file b8-drop-inside-function-body-does-not-count 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file b8-drop-inside-function-body-does-not-count 0000000002_unrelated_body_mentions_drop <<'SQL'
CREATE OR REPLACE FUNCTION public.emits_ddl_text() RETURNS TEXT
LANGUAGE plpgsql
AS $function$
BEGIN
  -- this body never runs "DROP FUNCTION public.internal_helper();" for real —
  -- it only returns the literal text below
  RETURN 'DROP FUNCTION public.internal_helper();';
END;
$function$;

CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 0 "B8: a DROP FUNCTION mentioned inside a function BODY (never actually run) does not count as a real reset" b8-drop-inside-function-body-does-not-count

echo ""
echo "-- round 6 (PR #723 review): B1 critical — degradation swallows any NEW violation in an M/R file --"

# ── B1 (round 6, CRITICAL): a function that did NOT exist at base has no
# events in baseTimeline for its name+signature, so isPublicOpenAt defaults
# to true (Postgres's own default) — which the old predicate read as
# "open at base" -> preexisting -> warn. A brand-new CREATE FUNCTION added
# by editing an EXISTING (M-status) file, opened to anon with no REVOKE,
# must still REJECT — the violating CREATE did not exist at base at all, so
# there is no "before" it could have been safe or unsafe at.
GIT_FIXTURE6="$TMP/gitrepo-rule5-base-new-fn-in-modified-file"
mkdir -p "$GIT_FIXTURE6/migrations"
(
  cd "$GIT_FIXTURE6"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_unrelated.sql <<'SQL'
ALTER TABLE public.packages ADD COLUMN foo TEXT;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000001_unrelated.sql <<'SQL'
ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE OR REPLACE FUNCTION public.brand_new_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.brand_new_fn() TO anon;
SQL
  git add -A
  git commit -q -m "PR edits the file to add a brand-new open function"
)
BASE_SHA6=$(cd "$GIT_FIXTURE6" && git rev-parse HEAD~1)
output6=$(cd "$GIT_FIXTURE6" && bash "$SCRIPT" --base "$BASE_SHA6" migrations 2>&1)
actual6=$?
if [ "$actual6" -eq 1 ] && printf '%s' "$output6" | grep -q "::error::.*brand_new_fn"; then
  pass=$((pass + 1))
  echo "  ok   B1 (round 6): a brand-new open function added by editing an existing file still rejects under --base"
else
  fail=$((fail + 1))
  echo "  FAIL B1 (round 6): a brand-new function in a modified file did not reject — expected exit 1 with ::error:: naming brand_new_fn, got exit $actual6"
  printf '%s\n' "$output6" | sed 's/^/         /'
fi

# ── B1 (round 6): a file both renamed AND substantially edited in the same
# commit. Verified: with THIS content delta, git's similarity heuristic does
# NOT classify it as a rename (R) — it comes out as A (new path) + D (old
# path), confirmed via `git status --short` against this exact fixture. That
# routes it through the already-tested "added file always rejects" path, not
# a new one — still asserted here as a regression guard, not claimed as
# covering a genuine R-status branch.
GIT_FIXTURE6R="$TMP/gitrepo-rule5-base-new-fn-in-renamed-file"
mkdir -p "$GIT_FIXTURE6R/migrations"
(
  cd "$GIT_FIXTURE6R"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_old_name.sql <<'SQL'
ALTER TABLE public.packages ADD COLUMN foo TEXT;
SQL
  git add -A
  git commit -q -m base
  git mv migrations/0000000001_old_name.sql migrations/0000000001_new_name.sql
  cat > migrations/0000000001_new_name.sql <<'SQL'
ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE OR REPLACE FUNCTION public.brand_new_fn_renamed() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.brand_new_fn_renamed() TO anon;
SQL
  git add -A
  git commit -q -m "PR renames the file AND adds a brand-new open function"
)
BASE_SHA6R=$(cd "$GIT_FIXTURE6R" && git rev-parse HEAD~1)
output6r=$(cd "$GIT_FIXTURE6R" && bash "$SCRIPT" --base "$BASE_SHA6R" migrations 2>&1)
actual6r=$?
if [ "$actual6r" -eq 1 ] && printf '%s' "$output6r" | grep -q "::error::.*brand_new_fn_renamed"; then
  pass=$((pass + 1))
  echo "  ok   B1 (round 6): a brand-new open function added while renaming the file still rejects under --base"
else
  fail=$((fail + 1))
  echo "  FAIL B1 (round 6): a brand-new function in a renamed file did not reject — expected exit 1 with ::error:: naming brand_new_fn_renamed, got exit $actual6r"
  printf '%s\n' "$output6r" | sed 's/^/         /'
fi

# ── B1 (round 6): the case most likely to slip through a per-FILE
# degradation — a file that ALREADY had one violating function at base
# (correctly degrades) gets a SECOND, brand-new violating function added by
# this PR (must reject). Proves the split is per-VIOLATION, not per-file —
# a file-level "any violation here is preexisting" would swallow the new
# one alongside the old one.
GIT_FIXTURE6M="$TMP/gitrepo-rule5-base-old-and-new-violation-same-file"
mkdir -p "$GIT_FIXTURE6M/migrations"
(
  cd "$GIT_FIXTURE6M"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_mixed.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.already_open_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000001_mixed.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.already_open_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.newly_added_open_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "PR adds a second, brand-new open function alongside the pre-existing one"
)
BASE_SHA6M=$(cd "$GIT_FIXTURE6M" && git rev-parse HEAD~1)
output6m=$(cd "$GIT_FIXTURE6M" && bash "$SCRIPT" --base "$BASE_SHA6M" migrations 2>&1)
actual6m=$?
has_old_warning=$(printf '%s' "$output6m" | grep -q "::warning::.*already_open_fn.*already present" && echo yes || echo no)
has_new_error=$(printf '%s' "$output6m" | grep -q "::error::.*newly_added_open_fn" && echo yes || echo no)
if [ "$actual6m" -eq 1 ] && [ "$has_old_warning" = "yes" ] && [ "$has_new_error" = "yes" ]; then
  pass=$((pass + 1))
  echo "  ok   B1 (round 6): the pre-existing violation degrades AND the new one in the SAME file rejects — per-violation, not per-file"
else
  fail=$((fail + 1))
  echo "  FAIL B1 (round 6): mixed old+new violations in one file did not split correctly — exit=$actual6m old_warning=$has_old_warning new_error=$has_new_error"
  printf '%s\n' "$output6m" | sed 's/^/         /'
fi

# ── B2 (round 6): the reviewer's construction proving the null-override-
# for-added-files branch IS observable — retracts round 5's "not
# observable" argument. Base: a hardened function (CREATE + REVOKE FROM
# PUBLIC, properly closed). This PR ADDS a file that sorts BEFORE it with a
# direct `GRANT ... TO anon` (genuinely opening it), and separately TOUCHES
# the hardened file (CREATE OR REPLACE, no ACL statements of its own — round
# 3's "preserves the ACL" pattern). The added file's GRANT is what makes the
# touched file's function open in `timeline` (the real one) at all — so,
# unlike round 5's failed attempt to observe this, the GRANT does not
# collapse the violation, it CREATES it. If the added file's phantom content
# leaks into `baseTimeline` (missing null override), the violation reads as
# "also open at base" and wrongly degrades to a warning instead of
# rejecting a GRANT this PR itself introduced.
GIT_FIXTURE7="$TMP/gitrepo-b2-added-grant-not-preexisting"
mkdir -p "$GIT_FIXTURE7/migrations"
(
  cd "$GIT_FIXTURE7"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_harden.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.shared_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.shared_fn() FROM PUBLIC;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000000_added_grant_to_anon.sql <<'SQL'
GRANT EXECUTE ON FUNCTION public.shared_fn() TO anon;
SQL
  cat > migrations/0000000001_harden.sql <<'SQL'
-- touched by this PR for an unrelated reason, no ACL statements of its own
CREATE OR REPLACE FUNCTION public.shared_fn() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.shared_fn() FROM PUBLIC;
SQL
  git add -A
  git commit -q -m "add an earlier-sorting file that GRANTs TO anon directly, and touch the hardened file"
)
BASE_SHA7=$(cd "$GIT_FIXTURE7" && git rev-parse HEAD~1)
output7=$(cd "$GIT_FIXTURE7" && bash "$SCRIPT" --base "$BASE_SHA7" migrations 2>&1)
actual7=$?
if [ "$actual7" -eq 1 ] && printf '%s' "$output7" | grep -q "::error::.*shared_fn"; then
  pass=$((pass + 1))
  echo "  ok   B2 (round 6): a GRANT ... TO anon introduced by an added file rejects — it is not read back as pre-existing"
else
  fail=$((fail + 1))
  echo "  FAIL B2 (round 6): the added file's GRANT was wrongly treated as pre-existing — expected exit 1, got exit $actual7"
  printf '%s\n' "$output7" | sed 's/^/         /'
fi

# ── B4 (round 6): SCHEMA_WIDE_GRANT_RE still only accepted `GRANT EXECUTE`
# — the exact asymmetry B2 (round 5) already fixed for the per-function
# GRANT_HEADER_RE, unfixed on the schema-wide axis B3 (round 5) introduced.
write_file b4-schema-wide-grant-all-to-anon-rejects 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file b4-schema-wide-grant-all-to-anon-rejects 0000000002_schema_wide_grant_all <<'SQL'
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;
SQL
write_file b4-schema-wide-grant-all-to-anon-rejects 0000000003_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "B4 (round 6): GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon reopens (not just GRANT EXECUTE)" b4-schema-wide-grant-all-to-anon-rejects

# ── B4 (round 6): ROUTINES is the PG11+ synonym for FUNCTIONS in this exact
# schema-wide grant form — must be recognized too.
write_file b4-schema-wide-grant-routines-to-anon-rejects 0000000001_harden <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_helper() FROM PUBLIC;
SQL
write_file b4-schema-wide-grant-routines-to-anon-rejects 0000000002_schema_wide_grant_routines <<'SQL'
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO anon;
SQL
write_file b4-schema-wide-grant-routines-to-anon-rejects 0000000003_replace_no_acl_touch <<'SQL'
CREATE OR REPLACE FUNCTION public.internal_helper() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
assert_exit 1 "B4 (round 6): GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO anon reopens (ROUTINES is the FUNCTIONS synonym)" b4-schema-wide-grant-routines-to-anon-rejects

# ── B5 (round 6): `GRANT EXECUTE ON ROUTINE public.f() TO anon` — the
# PG11+ singular synonym for `ON FUNCTION` in a per-function GRANT — failed
# OPEN (no diagnostic at all), the dangerous direction. Declared as debt in
# round 5 with the wrong characterization ("fails closed"); fixed here
# instead, since it's a one-line regex change same as B2/B4.
write_file b5-grant-on-routine-to-anon-rejects 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.h() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.h() FROM PUBLIC;
GRANT EXECUTE ON ROUTINE public.h() TO anon;
SQL
assert_exit 1 "B5 (round 6): GRANT EXECUTE ON ROUTINE (singular, PG11+ synonym for FUNCTION) ... TO anon rejects" b5-grant-on-routine-to-anon-rejects

# ── B5 negative/regression: REVOKE ... ON ROUTINE also recognized — a
# migration that correctly closes via the ROUTINE synonym must not be
# falsely rejected either (the symmetric direction of the same fix).
write_file b5-revoke-on-routine-closes-correctly 0000000001_fixture <<'SQL'
CREATE OR REPLACE FUNCTION public.h() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;

REVOKE ALL ON ROUTINE public.h() FROM PUBLIC;
SQL
assert_exit 0 "B5 (round 6): REVOKE ALL ON ROUTINE (singular, PG11+ synonym) FROM PUBLIC closes it correctly" b5-revoke-on-routine-closes-correctly

echo ""
echo "-- round 7 (PR #723 review): M1 — functionExistedAtBase measured EXISTENCE, not VIOLATION --"

# ── M1 (round 7): a function that existed at base as SECURITY INVOKER was
# never a rule-5 violation — INVOKER runs with the CALLER's own privileges,
# so anon being able to call it is not a privilege escalation. A PR that
# edits that SAME migration (status M) to flip it to SECURITY DEFINER
# INTRODUCES the exposure — `functionExistedAtBase` must not read this as
# "already existed" and degrade it. Same shape as B1 (round 6): existence
# alone is not enough, it must have been a VIOLATION already.
GIT_FIXTURE_M1="$TMP/gitrepo-m1-invoker-to-definer-flip"
mkdir -p "$GIT_FIXTURE_M1/migrations"
(
  cd "$GIT_FIXTURE_M1"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_flipper.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.flipper(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000001_flipper.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.flipper(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "PR flips flipper from INVOKER to DEFINER — this introduces the exposure"
)
BASE_SHA_M1=$(cd "$GIT_FIXTURE_M1" && git rev-parse HEAD~1)
output_m1=$(cd "$GIT_FIXTURE_M1" && bash "$SCRIPT" --base "$BASE_SHA_M1" migrations 2>&1)
actual_m1=$?
if [ "$actual_m1" -eq 1 ] && printf '%s' "$output_m1" | grep -q "::error::.*flipper"; then
  pass=$((pass + 1))
  echo "  ok   M1 (round 7): flipping SECURITY INVOKER -> DEFINER in a modified file rejects — it was never a violation at base"
else
  fail=$((fail + 1))
  echo "  FAIL M1 (round 7): the INVOKER->DEFINER flip did not reject — expected exit 1 with ::error:: naming flipper, got exit $actual_m1"
  printf '%s\n' "$output_m1" | sed 's/^/         /'
fi

# ── M1 (round 7): identical shape for RETURNS TRIGGER -> non-trigger. A
# trigger function was out of scope for rule 5 at base (never directly
# invocable via PostgREST/RPC); a PR that edits it to drop RETURNS TRIGGER
# (making it an ordinary, directly-callable function) introduces the same
# kind of new exposure and must reject, not degrade.
GIT_FIXTURE_M1B="$TMP/gitrepo-m1-trigger-to-nontrigger-flip"
mkdir -p "$GIT_FIXTURE_M1B/migrations"
(
  cd "$GIT_FIXTURE_M1B"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_detrigger.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.detrigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000001_detrigger.sql <<'SQL'
CREATE OR REPLACE FUNCTION public.detrigger() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "PR drops RETURNS TRIGGER — this introduces the exposure"
)
BASE_SHA_M1B=$(cd "$GIT_FIXTURE_M1B" && git rev-parse HEAD~1)
output_m1b=$(cd "$GIT_FIXTURE_M1B" && bash "$SCRIPT" --base "$BASE_SHA_M1B" migrations 2>&1)
actual_m1b=$?
if [ "$actual_m1b" -eq 1 ] && printf '%s' "$output_m1b" | grep -q "::error::.*detrigger"; then
  pass=$((pass + 1))
  echo "  ok   M1 (round 7): dropping RETURNS TRIGGER in a modified file rejects — it was never a violation at base"
else
  fail=$((fail + 1))
  echo "  FAIL M1 (round 7): the TRIGGER->non-trigger flip did not reject — expected exit 1 with ::error:: naming detrigger, got exit $actual_m1b"
  printf '%s\n' "$output_m1b" | sed 's/^/         /'
fi

# ── M2 (round 7): a GENUINE git rename (status R, not the A+D that a
# substantially-rewritten file lands as — see the B1 rename fixture above,
# documented honestly as landing A+D). Padding content kept identical so
# git's similarity heuristic detects the rename; only INVOKER->DEFINER
# changes. `functionExistedAtBase` must read the OLD content via
# `oldPathAtBase` (`git show base:<oldPath>`), not `filePath` (the NEW
# path, which never existed under that name at base) — closes the
# untested R-branch the review flagged (changing `oldPathAtBase` to
# `filePath` survived all 61 prior tests).
GIT_FIXTURE_M2="$TMP/gitrepo-m2-genuine-rename-invoker-to-definer"
mkdir -p "$GIT_FIXTURE_M2/migrations"
(
  cd "$GIT_FIXTURE_M2"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_old_name.sql <<'SQL'
-- padding line 1
-- padding line 2
-- padding line 3
-- padding line 4
-- padding line 5
-- padding line 6
-- padding line 7
-- padding line 8
-- padding line 9
-- padding line 10
CREATE OR REPLACE FUNCTION public.flipper2(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  git mv migrations/0000000001_old_name.sql migrations/0000000001_new_name.sql
  cat > migrations/0000000001_new_name.sql <<'SQL'
-- padding line 1
-- padding line 2
-- padding line 3
-- padding line 4
-- padding line 5
-- padding line 6
-- padding line 7
-- padding line 8
-- padding line 9
-- padding line 10
CREATE OR REPLACE FUNCTION public.flipper2(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "rename the file and flip INVOKER -> DEFINER"
)
BASE_SHA_M2=$(cd "$GIT_FIXTURE_M2" && git rev-parse HEAD~1)
status_m2=$(cd "$GIT_FIXTURE_M2" && git diff --name-status --diff-filter=AMR "$BASE_SHA_M2" -- migrations | cut -c1)
output_m2=$(cd "$GIT_FIXTURE_M2" && bash "$SCRIPT" --base "$BASE_SHA_M2" migrations 2>&1)
actual_m2=$?
if [ "$status_m2" = "R" ] && [ "$actual_m2" -eq 1 ] && printf '%s' "$output_m2" | grep -q "::error::.*flipper2"; then
  pass=$((pass + 1))
  echo "  ok   M2 (round 7): a genuine rename (status R) with an INVOKER->DEFINER flip still rejects"
else
  fail=$((fail + 1))
  echo "  FAIL M2 (round 7): expected status=R and exit=1 with ::error:: naming flipper2 — got status=$status_m2 exit=$actual_m2"
  printf '%s\n' "$output_m2" | sed 's/^/         /'
fi

# ── M2 negative (round 7): the counterpart that actually exercises
# `oldPathAtBase` — the reject-case above passes even with the
# `oldPathAtBase -> filePath` mutant, because `git show base:<NEW path>`
# fails regardless (the new path never existed at base) and a failed
# lookup already means "reject". This one is a GENUINE rename where the
# function was ALREADY SECURITY DEFINER and ALREADY open at base — no ACL
# change at all, just the rename — and must DEGRADE (warn, exit 0). Under
# the mutant, `git show base:<new path>` fails -> functionExistedAtBase
# wrongly returns false -> wrongly REJECTS a genuinely pre-existing
# violation whose only "change" was being renamed.
GIT_FIXTURE_M2B="$TMP/gitrepo-m2-genuine-rename-already-open"
mkdir -p "$GIT_FIXTURE_M2B/migrations"
(
  cd "$GIT_FIXTURE_M2B"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_old_name2.sql <<'SQL'
-- padding line 1
-- padding line 2
-- padding line 3
-- padding line 4
-- padding line 5
-- padding line 6
-- padding line 7
-- padding line 8
-- padding line 9
-- padding line 10
CREATE OR REPLACE FUNCTION public.already_open_renamed(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m base
  git mv migrations/0000000001_old_name2.sql migrations/0000000001_new_name2.sql
  cat > migrations/0000000001_new_name2.sql <<'SQL'
-- padding line 1
-- padding line 2
-- padding line 3
-- padding line 4
-- padding line 5
-- padding line 6
-- padding line 7
-- padding line 8
-- padding line 9
-- padding line 11 (only this comment changed, ACL untouched)
CREATE OR REPLACE FUNCTION public.already_open_renamed(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  NULL;
END;
$function$;
SQL
  git add -A
  git commit -q -m "rename only, no ACL change — was already open at base"
)
BASE_SHA_M2B=$(cd "$GIT_FIXTURE_M2B" && git rev-parse HEAD~1)
status_m2b=$(cd "$GIT_FIXTURE_M2B" && git diff --name-status --diff-filter=AMR "$BASE_SHA_M2B" -- migrations | cut -c1)
output_m2b=$(cd "$GIT_FIXTURE_M2B" && bash "$SCRIPT" --base "$BASE_SHA_M2B" migrations 2>&1)
actual_m2b=$?
if [ "$status_m2b" = "R" ] && [ "$actual_m2b" -eq 0 ] && printf '%s' "$output_m2b" | grep -q "::warning::.*already_open_renamed.*already present"; then
  pass=$((pass + 1))
  echo "  ok   M2 negative (round 7): a genuine rename with no ACL change degrades (already open at base) — exercises oldPathAtBase for real"
else
  fail=$((fail + 1))
  echo "  FAIL M2 negative (round 7): expected status=R and exit=0 with a degradation warning — got status=$status_m2b exit=$actual_m2b"
  printf '%s\n' "$output_m2b" | sed 's/^/         /'
fi

echo ""
echo "check-migration-safety.sh (rules 4/5): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
