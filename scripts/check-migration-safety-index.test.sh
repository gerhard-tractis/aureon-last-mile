#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — rule 2: warns
# (never rejects) on CREATE INDEX / CREATE UNIQUE INDEX without CONCURRENTLY
# over a known-large table (packages, orders, dispatches, routes).
# Run: bash scripts/check-migration-safety-index.test.sh
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

echo "check-migration-safety.sh — rule 2 (CREATE INDEX without CONCURRENTLY)"

write_fixture warn-index-no-concurrently <<'SQL'
BEGIN;

CREATE INDEX IF NOT EXISTS idx_packages_foo
  ON public.packages (foo)
  WHERE deleted_at IS NULL;

COMMIT;
SQL
assert_exit 0 "warns (does not reject) a CREATE INDEX without CONCURRENTLY on packages" warn-index-no-concurrently
assert_contains "::warning::" "prints ::warning:: for CREATE INDEX without CONCURRENTLY on packages" warn-index-no-concurrently
assert_contains "packages" "warning names the large table" warn-index-no-concurrently

write_fixture accept-index-concurrently <<'SQL'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_packages_foo
  ON public.packages (foo)
  WHERE deleted_at IS NULL;
SQL
assert_not_contains "::warning::" "does not warn when CONCURRENTLY is used" accept-index-concurrently

write_fixture accept-index-small-table <<'SQL'
BEGIN;

CREATE INDEX IF NOT EXISTS idx_route_blocks_foo
  ON public.route_blocks (foo);

COMMIT;
SQL
assert_not_contains "::warning::" "does not warn about an index on a table outside the known-large list" accept-index-small-table

write_fixture warn-orders-and-dispatches <<'SQL'
BEGIN;

CREATE INDEX IF NOT EXISTS idx_orders_foo ON public.orders (foo);
CREATE INDEX IF NOT EXISTS idx_dispatches_foo ON public.dispatches (foo);

COMMIT;
SQL
assert_contains "orders" "warns about orders too" warn-orders-and-dispatches
assert_contains "dispatches" "warns about dispatches too" warn-orders-and-dispatches

# ── m8 (review round 1): `ON "public"."packages"` (both parts quoted) was
# parsed as table "public", so the warning never named the real table.
write_fixture warn-quoted-schema-and-table <<'SQL'
BEGIN;

CREATE INDEX IF NOT EXISTS idx_packages_foo
  ON "public"."packages" (foo)
  WHERE deleted_at IS NULL;

COMMIT;
SQL
assert_contains "packages" "a fully-quoted schema.table still names the real table, not \"public\"" warn-quoted-schema-and-table

# ── m9 (review round 1): rule 2 ran on raw text, so a `-- ...` comment
# mentioning a CREATE INDEX in prose produced a false ::warning::.
write_fixture accept-index-mentioned-only-in-comment <<'SQL'
-- We used to CREATE UNIQUE INDEX ON packages (foo) here, but reverted it.
BEGIN;

ALTER TABLE public.route_blocks ADD COLUMN foo TEXT;

COMMIT;
SQL
assert_not_contains "::warning::" "a CREATE INDEX mentioned only in a comment does not produce a warning" accept-index-mentioned-only-in-comment

echo ""
echo "check-migration-safety.sh (rule 2): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
