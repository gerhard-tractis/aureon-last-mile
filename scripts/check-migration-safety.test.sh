#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — rule 1: rejects a
# migration that mixes DDL with a top-level, unbounded backfill.
# Run: bash scripts/check-migration-safety.test.sh
#
# Split from the rest of the suite (rules 2/3, and the real-migrations
# validation set) the same way check-quarantine.test.sh was split from
# check-quarantine-report.test.sh — one file per concern, kept under 300
# lines. See check-migration-safety-index.test.sh,
# check-migration-safety-unique.test.sh and check-migration-safety-real.test.sh.
#
# The pattern that must NOT be rejected is the whole point of this phase:
# `20260909000001` (spec-79) has ADD COLUMN + CREATE FUNCTION that CONTAINS
# an UPDATE but is never invoked by the migration. Flagging that as
# dangerous is exactly the false positive fase 3's postmortem singles out.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-migration-safety.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# write_fixture <name> <content>
write_fixture() {
  mkdir -p "$TMP/$1"
  cat > "$TMP/$1/0000000001_fixture.sql"
}

# assert_exit <expected_code> <name> <dir>
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

# assert_contains <needle> <name> <dir>
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

echo "check-migration-safety.sh — rule 1 (DDL + unbounded backfill)"

write_fixture reject-ddl-plus-backfill <<'SQL'
BEGIN;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS foo TEXT;

UPDATE public.packages SET foo = 'bar' WHERE deleted_at IS NULL;

COMMIT;
SQL
assert_exit 1 "rejects DDL + top-level UPDATE backfill in the same file" reject-ddl-plus-backfill
assert_contains "::error::" "prints ::error:: for the DDL+backfill mix" reject-ddl-plus-backfill

write_fixture reject-ddl-plus-insert-select <<'SQL'
BEGIN;

CREATE TABLE public.foo_cache (id UUID PRIMARY KEY, val TEXT);

INSERT INTO public.foo_cache (id, val)
  SELECT id, val FROM public.foo_source WHERE deleted_at IS NULL;

COMMIT;
SQL
assert_exit 1 "rejects DDL + top-level INSERT...SELECT backfill in the same file" reject-ddl-plus-insert-select

# ── The pattern that must NOT be rejected: spec79_backfill_loaded_route_id ──
# (20260909000001) — ADD COLUMN + CREATE INDEX, and a function that CONTAINS
# an UPDATE but is never called at the top level.

write_fixture accept-function-not-invoked <<'SQL'
BEGIN;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS loaded_route_id UUID REFERENCES public.routes(id);

CREATE INDEX IF NOT EXISTS idx_packages_loaded_route_id
  ON public.packages (loaded_route_id)
  WHERE loaded_route_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.spec79_backfill_loaded_route_id()
RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
DECLARE
  backfilled BIGINT;
BEGIN
  UPDATE public.packages p
     SET loaded_route_id = d.route_id
    FROM (SELECT order_id, route_id FROM public.dispatches) d
   WHERE d.order_id = p.order_id;
  GET DIAGNOSTICS backfilled = ROW_COUNT;
  RETURN backfilled;
END;
$fn$;

-- Deliberately NOT invoked here — call it by hand after measuring.

COMMIT;
SQL
assert_exit 0 "does NOT reject DDL + UPDATE inside an uninvoked function body (spec-79 pattern)" accept-function-not-invoked

write_fixture accept-ddl-only <<'SQL'
BEGIN;

ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_stage_check;

ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_stage_check CHECK (stage IN ('draft','force_split'));

COMMIT;
SQL
assert_exit 0 "does not reject a migration with DDL and no backfill at all" accept-ddl-only

# ── B1 (review round 1): a bare UPDATE inside a DO $$ block DOES run at
# deploy time, unlike a CREATE FUNCTION body. Blanking every dollar-quoted
# body indiscriminately made this invisible.
write_fixture reject-ddl-plus-do-block-backfill <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN load_state TEXT;

DO $$
BEGIN
  UPDATE public.packages SET load_state = 'en_bodega' WHERE load_state IS NULL;
END $$;

COMMIT;
SQL
assert_exit 1 "rejects DDL + a top-level backfill hidden inside a DO block" reject-ddl-plus-do-block-backfill

# ── B2 (review round 1): declaring a function is inert, but a migration
# that ALSO invokes it at the top level runs the backfill at deploy time —
# this is the exact line the false-positive-avoidance overcorrected past.
write_fixture reject-ddl-plus-invoked-function <<'SQL'
BEGIN;

ALTER TABLE public.packages ADD COLUMN foo TEXT;

CREATE FUNCTION public.backfill_foo() RETURNS VOID LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.packages SET foo = 'x';
END;
$fn$;

SELECT public.backfill_foo();

COMMIT;
SQL
assert_exit 1 "rejects DDL + a declared AND invoked backfill function" reject-ddl-plus-invoked-function

# ── Real-world B1 case: 20260810000002_spec51_repair_wrongly_cancelled_orders
# stages a `CREATE TEMP TABLE` and, inside the same top-level DO block, runs
# an unbounded UPDATE keyed off it. `CREATE TEMP TABLE` did not match
# DDL_RE (only `CREATE TABLE`, without TEMP, did), so DDL_RE.test() failed
# and rule 1 never even reached the UPDATE check.
write_fixture reject-create-temp-table-plus-do-block-backfill <<'SQL'
DO $$
DECLARE
  v_affected INT;
BEGIN
  CREATE TEMP TABLE spec51_wrongly_cancelled ON COMMIT DROP AS
  SELECT o.id FROM public.orders o WHERE o.status = 'cancelado';

  SELECT count(*) INTO v_affected FROM spec51_wrongly_cancelled;

  UPDATE public.packages p
  SET status = p.status
  WHERE p.deleted_at IS NULL
    AND p.order_id IN (SELECT id FROM spec51_wrongly_cancelled);
END $$;
SQL
assert_exit 1 "rejects a top-level CREATE TEMP TABLE + unbounded UPDATE inside the same DO block" reject-create-temp-table-plus-do-block-backfill

# ── B3 (review round 1): a $$ inside a `-- ...` comment used to pair with
# the real function's opening $$ and blank out everything up to and
# including the ALTER TABLE, making DDL_RE never fire.
write_fixture reject-ddl-plus-backfill-with-dollar-in-comment <<'SQL'
-- this migration uses a $$-quoted body below
BEGIN;

ALTER TABLE public.orders ADD COLUMN bar TEXT;

CREATE FUNCTION public.f() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  RETURN;
END;
$$;

UPDATE public.orders SET bar = 'x';

COMMIT;
SQL
assert_exit 1 "a \$\$ inside a line comment does not blank out the DDL that follows it" reject-ddl-plus-backfill-with-dollar-in-comment

# ── M5 (review round 1): the rejection message says "unbounded", but the
# rule rejected ANY top-level UPDATE regardless of scope. A single-row
# update by primary-key literal is not a backfill.
write_fixture accept-ddl-plus-bounded-single-row-update <<'SQL'
BEGIN;

ALTER TABLE public.dock_zones ADD COLUMN sort_order INT;

UPDATE public.dock_zones SET sort_order = 1
  WHERE id = '11111111-1111-1111-1111-111111111111';

COMMIT;
SQL
assert_exit 0 "does not reject DDL + a single-row UPDATE bounded by an id literal" accept-ddl-plus-bounded-single-row-update

echo ""
echo "check-migration-safety.sh (rule 1): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
