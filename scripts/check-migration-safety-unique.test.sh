#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — rule 3: warns
# (never rejects) on a CREATE UNIQUE INDEX over an EXISTING table with no
# preceding COUNT(*)-guarded conditional.
# Run: bash scripts/check-migration-safety-unique.test.sh
#
# `20260911000002` (h5c) is the worked example of doing this correctly:
# count conflicts first, only create the index inside the branch where the
# count is zero. It must NOT warn.
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

echo "check-migration-safety.sh — rule 3 (unguarded CREATE UNIQUE INDEX)"

# Table deliberately NOT in the known-large list, to isolate this
# assertion from rule 2's own warning.
write_fixture warn-unique-index-unguarded <<'SQL'
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_return_receptions_session
  ON public.return_receptions (session_id)
  WHERE deleted_at IS NULL;

COMMIT;
SQL
assert_exit 0 "warns (does not reject) an unguarded CREATE UNIQUE INDEX on an existing table" warn-unique-index-unguarded
assert_contains "no preceding COUNT" "prints ::warning:: for the unguarded CREATE UNIQUE INDEX" warn-unique-index-unguarded

# The h5c pattern (20260911000002): count conflicts first, only create the
# unique index inside the branch where the count is zero. Must NOT warn.
write_fixture accept-unique-index-guarded <<'SQL'
BEGIN;

DO $$
DECLARE
  v_conflict_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_conflict_count
    FROM (
      SELECT operator_id, vehicle_id, route_date
        FROM public.routes
       WHERE deleted_at IS NULL
       GROUP BY operator_id, vehicle_id, route_date
      HAVING COUNT(*) > 1
    ) conflicts;

  IF v_conflict_count > 0 THEN
    RAISE NOTICE 'skipping index creation: % conflict(s)', v_conflict_count;
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS routes_one_vehicle_per_day '
      || 'ON public.routes (operator_id, vehicle_id, route_date) '
      || 'WHERE deleted_at IS NULL';
  END IF;
END $$;

COMMIT;
SQL
# (routes has no CONCURRENTLY either, so rule 2 legitimately still fires —
# see check-migration-safety-real.test.sh. Only rule 3's wording must be
# absent here.)
assert_not_contains "no preceding COUNT" "does not warn about a CREATE UNIQUE INDEX guarded by a prior COUNT(*) check (h5c pattern)" accept-unique-index-guarded

# A CREATE UNIQUE INDEX on a table created earlier IN THE SAME FILE cannot
# have live rows yet — no guard is needed (spec-85's discrepancies schema).
write_fixture accept-unique-index-new-table <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS public.widgets (
  id UUID PRIMARY KEY,
  operator_id UUID NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_widgets_operator
  ON public.widgets (operator_id)
  WHERE deleted_at IS NULL;

COMMIT;
SQL
assert_not_contains "::warning::" "does not warn about a CREATE UNIQUE INDEX on a table created in the same file" accept-unique-index-new-table

echo ""
echo "check-migration-safety.sh (rule 3): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
