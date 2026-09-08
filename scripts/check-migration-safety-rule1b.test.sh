#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — rule 1, review round
# 2: B1 (nearest CREATE FUNCTION wins, not the first in the window), B2 (a
# call inside an UNRELATED function's own body must not count as top-level),
# M5 (SELECT * FROM name() / SELECT count(*) FROM name() also invoke a
# backfill function), M6 (a backfill into a table CREATE TABLE'd earlier in
# the same file cannot block anyone — degrades to ::warning::).
# Run: bash scripts/check-migration-safety-rule1b.test.sh
#
# Split out from check-migration-safety.test.sh to stay under the repo's
# 300-line file limit, same pattern as check-quarantine*.test.sh.
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

echo "check-migration-safety.sh — rule 1, round 2 (B1, B2, M5, M6)"

# ── B1: findInvokedBackfillFunction used to attribute the $$ body to the
# FIRST function declared in its 400-char lookback window, not the nearest
# one. Declaring a short, unrelated function right before the real backfill
# used to steal the blame and let the real one slip through as PASS.
write_fixture reject-b1-nearest-function-wins <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE FUNCTION public.helper_a() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;

CREATE FUNCTION public.bf_b() RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.packages SET foo = 'x'; END;
$$;

SELECT public.bf_b();

COMMIT;
SQL
assert_exit 1 "B1: rejects when the NEAREST declared function (bf_b) is invoked, not the first one in the window (helper_a)" reject-b1-nearest-function-wins
assert_contains "bf_b" "B1: names the correct function (bf_b), not the unrelated earlier one" reject-b1-nearest-function-wins

# ── B1 mirror: invoking the SHORT, harmless function must not falsely
# attribute bf_b's real backfill body to it and reject.
write_fixture accept-b1-invoking-harmless-function <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE FUNCTION public.helper_a() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;

CREATE FUNCTION public.bf_b() RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.packages SET foo = 'x'; END;
$$;

SELECT public.helper_a();

COMMIT;
SQL
assert_exit 0 "B1: does not reject when only the harmless function (helper_a, body is SELECT 1) is invoked" accept-b1-invoking-harmless-function

# ── B2: PERFORM/SELECT of a backfill function's name INSIDE ANOTHER
# function's own body is not a top-level call — PERFORM is only legal inside
# a plpgsql body in the first place, so this half of the detector can never
# legitimately be "top level" outside a DO block.
write_fixture accept-b2-call-inside-unrelated-function-body <<'SQL'
BEGIN;

CREATE TABLE public.notes (id uuid);

CREATE FUNCTION public.bf() RETURNS void LANGUAGE plpgsql AS $bf$
BEGIN UPDATE public.notes SET id = id; END;
$bf$;

CREATE FUNCTION public.rpc_x() RETURNS void LANGUAGE plpgsql AS $b$
BEGIN PERFORM public.bf(); END;
$b$;

COMMIT;
SQL
assert_exit 0 "B2: does not reject when the only invocation of bf() is inside rpc_x's own declared-but-uninvoked body" accept-b2-call-inside-unrelated-function-body

# ── M5: SELECT * FROM name() / SELECT count(*) FROM name() is the idiomatic
# way to invoke a RETURNS TABLE(...) function — bare `SELECT name(` missed it.
write_fixture reject-m5-select-star-from-function <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE FUNCTION public.bf() RETURNS TABLE(id uuid) LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.packages SET foo = 'x';
  RETURN QUERY SELECT p.id FROM public.packages p;
END;
$fn$;

SELECT * FROM public.bf();

COMMIT;
SQL
assert_exit 1 "M5: rejects a backfill function invoked as SELECT * FROM name()" reject-m5-select-star-from-function

write_fixture reject-m5-select-count-from-function <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE FUNCTION public.bf() RETURNS TABLE(id uuid) LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.packages SET foo = 'x';
  RETURN QUERY SELECT p.id FROM public.packages p;
END;
$fn$;

SELECT count(*) FROM bf();

COMMIT;
SQL
assert_exit 1 "M5: rejects a backfill function invoked as SELECT count(*) FROM name()" reject-m5-select-count-from-function

# ── M6: a backfill (UPDATE/INSERT...SELECT, or a declared+invoked function)
# that writes into a table CREATE TABLE'd earlier in the SAME file cannot
# block anyone — no OID exists for another backend to have opened, no
# readers exist yet. Must degrade to ::warning::, not ::error::. This is the
# 20260913000001 (spec-85 discrepancies) shape: CREATE TABLE discrepancies +
# a declared-and-invoked function whose body INSERTs into it.
write_fixture warn-m6-backfill-into-table-created-here <<'SQL'
BEGIN;

CREATE TABLE public.discrepancies (id uuid, note text);

CREATE FUNCTION public.backfill_discrepancies() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.discrepancies (id, note)
    SELECT id, note FROM public.discrepancy_notes WHERE deleted_at IS NULL;
END;
$fn$;

SELECT public.backfill_discrepancies();

COMMIT;
SQL
assert_exit 0 "M6: does not hard-reject a backfill into a table created earlier in the same file" warn-m6-backfill-into-table-created-here
assert_contains "::warning::" "M6: still warns about the backfill into the newly-created table" warn-m6-backfill-into-table-created-here
assert_contains "discrepancies" "M6: warning names the destination table" warn-m6-backfill-into-table-created-here

# ── M6 mirror: the SAME shape but the destination table is NOT created in
# this file (an ordinary EXISTING table) — this must still hard-reject.
# Otherwise M6 would be "any DDL + any backfill", which is exactly the false
# negative it must not introduce.
write_fixture reject-m6-backfill-into-existing-table-not-created-here <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN loaded_at TIMESTAMPTZ;

CREATE FUNCTION public.backfill_loaded_at() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.packages SET loaded_at = NOW();
END;
$fn$;

SELECT public.backfill_loaded_at();

COMMIT;
SQL
assert_exit 1 "M6 mirror: still hard-rejects a backfill into an EXISTING table (packages), not created in this file" reject-m6-backfill-into-existing-table-not-created-here

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
echo "check-migration-safety.sh (rule 1, round 2+3): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
