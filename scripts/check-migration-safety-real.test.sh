#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — the validation set:
# runs the checker against the 12 real migrations fase 3 inventoried by hand
# (docs/specs/spec-87-desbloquear-produccion.md), and against a real git
# repo fixture to prove --base scoping actually works.
# Run: bash scripts/check-migration-safety-real.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-migration-safety.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

echo "check-migration-safety.sh — real migrations + --base scoping"

# ── Against the real, already-shipped migrations (the validation set) ───────
# The 12 migrations fase 3 inventoried by hand. This check runs them
# explicitly by name, NOT the whole migrations/ directory — the directory
# holds 90+ older migrations that predate this guard and legitimately mix
# DDL with a top-level backfill (they shipped years before this phase
# existed); scanning the full history would reject the build forever on
# files nobody is touching. Scoping to new files only (see the --base
# section below) is what makes rule 1 enforceable without relitigating
# history.
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/database/supabase/migrations"
TWELVE="
20260907000001_spec76_en_bodega_not_dock_ready.sql
20260908000001_spec77_force_split.sql
20260908000002_spec77_retorno_hub_clears_load_fact.sql
20260909000001_spec79_loaded_route_id.sql
20260910000001_spec79_backfill_route_scope_fix.sql
20260911000001_spec79_dispatch_attempt_claim.sql
20260911000002_spec79_h5c_vehicle_per_day_index.sql
20260911000003_spec79_b1_withdraw_vehicle_per_day_index.sql
20260912000001_recogida_visible_when_carga_verified.sql
20260913000001_spec85_discrepancies_schema.sql
20260913000002_spec80_close_manifest.sql
20260913000003_spec85_discrepancies_rpcs.sql
"
if [ -d "$MIGRATIONS_DIR" ]; then
  TWELVE_PATHS=()
  for name in $TWELVE; do
    TWELVE_PATHS+=("$MIGRATIONS_DIR/$name")
  done
  output=$(bash "$SCRIPT" "${TWELVE_PATHS[@]}" 2>&1)
  actual=$?
  if [ "$actual" -eq 0 ]; then
    pass=$((pass + 1))
    echo "  ok   none of the 12 fase-3 migrations is rejected"
  else
    fail=$((fail + 1))
    echo "  FAIL one of the 12 fase-3 migrations was rejected — expected 0, got $actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
  # 20260909000001 is the exact pattern this phase exists to stop
  # false-positiving on — assert it by name, not just "the whole set is 0".
  if printf '%s' "$output" | grep -q "20260909000001.*::error::\|::error::.*20260909000001"; then
    fail=$((fail + 1))
    echo "  FAIL 20260909000001 (spec79_loaded_route_id) was flagged dangerous — it is the correct pattern"
  else
    pass=$((pass + 1))
    echo "  ok   20260909000001 (spec79_loaded_route_id) is not flagged dangerous"
  fi
  # Rule 2 should still fire against the real files: 20260909000001
  # (packages) and 20260911000002 (routes) both create an index without
  # CONCURRENTLY, which fase 3's own table marks "medio" risk for exactly
  # this reason.
  if printf '%s' "$output" | grep -q "::warning::.*packages" && printf '%s' "$output" | grep -q "::warning::.*routes"; then
    pass=$((pass + 1))
    echo "  ok   still warns about CREATE INDEX without CONCURRENTLY on packages and routes"
  else
    fail=$((fail + 1))
    echo "  FAIL expected a ::warning:: naming packages and one naming routes"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
else
  echo "  skip migrations directory not found at $MIGRATIONS_DIR"
fi

# ── --base scoping: only newly ADDED files are checked, so 90+ older
# migrations that predate this guard cannot fail the build. ────────────────
GIT_FIXTURE="$TMP/gitrepo"
mkdir -p "$GIT_FIXTURE/migrations"
(
  cd "$GIT_FIXTURE"
  git init -q
  git config user.email test@example.com
  git config user.name test
  cat > migrations/0000000001_old_and_bad.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  git add -A
  git commit -q -m base
  cat > migrations/0000000002_new_and_bad.sql <<'SQL'
BEGIN;
ALTER TABLE public.orders ADD COLUMN bar TEXT;
UPDATE public.orders SET bar = 'baz';
COMMIT;
SQL
  git add -A
  git commit -q -m "add new migration"
)
BASE_SHA=$(cd "$GIT_FIXTURE" && git rev-parse HEAD~1)
output=$(cd "$GIT_FIXTURE" && bash "$SCRIPT" --base "$BASE_SHA" migrations 2>&1)
actual=$?
if [ "$actual" -eq 1 ]; then
  pass=$((pass + 1))
  echo "  ok   --base rejects a newly added migration that mixes DDL + backfill"
else
  fail=$((fail + 1))
  echo "  FAIL --base did not reject the newly added bad migration — expected exit 1, got $actual"
  printf '%s\n' "$output" | sed 's/^/         /'
fi
if printf '%s' "$output" | grep -qF "old_and_bad"; then
  fail=$((fail + 1))
  echo "  FAIL --base checked a migration that already existed at the base commit"
else
  pass=$((pass + 1))
  echo "  ok   --base does not check a migration that already existed at the base commit"
fi

echo ""
echo "check-migration-safety.sh (real + --base): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
