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

echo ""
echo "check-migration-safety.sh (rule 1): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
