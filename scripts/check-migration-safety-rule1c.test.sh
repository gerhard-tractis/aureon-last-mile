#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — rule 1, review
# round 3: F1 (extractDestinationTable was anchored to the START of a
# string, so it went blind against a function BODY that starts at `$$`, not
# at the UPDATE — it silently fell through to the first INSERT INTO and hid
# any other write in the same body), F2 (CREATE TABLE IF NOT EXISTS must
# NOT count as "created in this file" for M6's exemption — its whole
# contract is "may already exist, with rows and readers"), F3 (M6's warning
# text overclaimed "nothing can be locked out" when it only reasons about
# the destination table, not the source of an INSERT ... SELECT or how long
# the deploy transaction stays open).
# Run: bash scripts/check-migration-safety-rule1c.test.sh
#
# Split out from check-migration-safety-rule1b.test.sh to stay under the
# repo's 300-line file limit, same pattern as check-quarantine*.test.sh.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-migration-safety.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

write_fixture() {
  mkdir -p "$TMP/$1"
  cat > "$TMP/$1/0000000001_fixture.sql"
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

echo "check-migration-safety.sh — rule 1, round 3 (F1, F2, F3)"

# ── F1 (round 3): extractDestinationTable anchored UPDATE-matching to the
# START of the string (`^\s*UPDATE`). Called against a FUNCTION BODY (which
# starts at the `$$` tag, not at the UPDATE), that anchor can never match, so
# the function silently fell through to the first INSERT INTO in the body —
# any OTHER write in the same body (e.g. a real UPDATE against an existing,
# live table) went completely unseen. Reviewer's exact fixture: the body
# UPDATEs a pre-existing table (packages) AND INSERTs into a table created in
# the same file (foo_cache) — must still hard-reject on the packages write.
write_fixture reject-f1-body-has-update-and-insert <<'SQL'
BEGIN;

CREATE TABLE public.foo_cache (id uuid primary key, v text);

CREATE FUNCTION public.backfill_all() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.packages SET status = 'reset';
  INSERT INTO public.foo_cache (id, v) SELECT id, 'x' FROM public.packages;
END;
$$;

SELECT public.backfill_all();

COMMIT;
SQL
assert_exit 1 "F1: rejects when a function body UPDATEs an EXISTING table, even though it also INSERTs into a table created in this file" reject-f1-body-has-update-and-insert
assert_contains "::error::" "F1: the packages write is a hard reject, not downgraded" reject-f1-body-has-update-and-insert

# ── F1 mirror: EVERY write in the body targets a table created in this same
# file — this must still degrade to a warning (M6's actual scope, not
# widened by fixing F1's single-write blind spot).
write_fixture warn-f1-all-writes-created-here <<'SQL'
BEGIN;

CREATE TABLE public.foo_cache (id uuid primary key, v text);
CREATE TABLE public.foo_log (id uuid primary key, note text);

CREATE FUNCTION public.backfill_all() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.foo_cache SET v = 'reset';
  INSERT INTO public.foo_log (id, note) SELECT id, 'x' FROM public.foo_cache;
END;
$$;

SELECT public.backfill_all();

COMMIT;
SQL
assert_exit 0 "F1 mirror: does not hard-reject when EVERY write in the body targets a table created in this file" warn-f1-all-writes-created-here
assert_contains "::warning::" "F1 mirror: still warns" warn-f1-all-writes-created-here

# ── F2 (round 3): CREATE TABLE IF NOT EXISTS must NOT count as "created in
# this file" for M6's purposes — its whole contract is "may already exist,
# with rows and with readers", which is the exact opposite of M6's premise
# ("no OID exists for another backend to have opened, no readers exist
# yet"). A backfill into a table declared with IF NOT EXISTS must stay a
# hard ::error::, not degrade to a warning.
write_fixture reject-f2-if-not-exists-does-not-count-as-created-here <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS public.discrepancies (id uuid, note text);

CREATE FUNCTION public.backfill_discrepancies() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.discrepancies (id, note)
    SELECT id, note FROM public.discrepancy_notes WHERE deleted_at IS NULL;
END;
$fn$;

SELECT public.backfill_discrepancies();

COMMIT;
SQL
assert_exit 1 "F2: CREATE TABLE IF NOT EXISTS does not exempt a backfill into it — the table may already exist with rows and readers" reject-f2-if-not-exists-does-not-count-as-created-here

# ── F3 (round 3): M6's warning text claimed "nothing can be locked out",
# which is only true of the DESTINATION table. It says nothing about the
# SOURCE of an INSERT ... SELECT — an existing, live table gets a full scan
# (AccessShareLock, held for the length of the read) inside the deploy's own
# transaction. 20260306000001:316 is exactly this shape: INSERT INTO
# dispatches ... SELECT ... FROM delivery_attempts, a preexisting table.
# The message must not assert blanket safety it cannot back up.
write_fixture warn-f3-message-does-not-overclaim-safety <<'SQL'
BEGIN;

CREATE TABLE public.foo_cache (id uuid primary key, v text);
CREATE TABLE public.delivery_attempts_existing_marker (id uuid);

CREATE FUNCTION public.backfill_all() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.foo_cache (id, v) SELECT id, 'x' FROM public.delivery_attempts;
END;
$$;

SELECT public.backfill_all();

COMMIT;
SQL
assert_contains "::warning::" "F3: still warns (destination genuinely created here)" warn-f3-message-does-not-overclaim-safety
if bash "$SCRIPT" "$TMP/warn-f3-message-does-not-overclaim-safety" 2>&1 | grep -qF "nothing can be locked out"; then
  fail=$((fail + 1))
  echo "  FAIL F3: warning text still claims blanket 'nothing can be locked out', ignoring the SOURCE table and transaction duration"
else
  pass=$((pass + 1))
  echo "  ok   F3: warning text no longer overclaims blanket safety"
fi
assert_contains "source" "F3: warning text calls out that the SOURCE table (and transaction duration) is a separate, unaddressed risk" warn-f3-message-does-not-overclaim-safety

echo ""
echo "check-migration-safety.sh (rule 1, round 3): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
