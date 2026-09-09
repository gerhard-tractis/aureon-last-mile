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
# 20260913000001 is a documented case, added by review round 1 (B2) and
# revisited twice since: it CREATE TABLE IF NOT EXISTS's `discrepancies`
# and, at the top level, both declares AND invokes a function whose body
# backfills it from `discrepancy_notes` — exactly the pattern B2 exists to
# catch. Round 2's M6 degraded this to a ::warning:: on the theory that a
# table created earlier in the same file cannot have live rows/readers yet.
# Round 3's F2 corrects that: `IF NOT EXISTS` is precisely the syntax whose
# CONTRACT is "may already exist, with rows and readers" — M6's premise
# does not hold for it. `isTableCreatedBefore` now only recognizes a BARE
# `CREATE TABLE`, so this file is back to a hard ::error::. It already
# shipped and ran safely under fase 3/4's separate by-hand review, which is
# why this is not treated as a live incident — but the STATIC guard cannot
# tell "ran fine once, verified by hand" from "about to lock production",
# and F2 declines to let IF NOT EXISTS pretend it can.
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
  # F2 (review round 3): 20260913000001's CREATE TABLE IF NOT EXISTS no
  # longer exempts its backfill, so the batch as a whole now exits 1.
  if [ "$actual" -eq 1 ]; then
    pass=$((pass + 1))
    echo "  ok   the batch hard-rejects (20260913000001's CREATE TABLE IF NOT EXISTS no longer exempts its backfill — F2)"
  else
    fail=$((fail + 1))
    echo "  FAIL expected exit 1 — got $actual"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
  if printf '%s' "$output" | grep -q "::error::.*20260913000001.*declares AND invokes"; then
    pass=$((pass + 1))
    echo "  ok   20260913000001 (spec85_discrepancies_schema) is a ::error:: — declares AND invokes a backfill (B2) into a table declared IF NOT EXISTS (F2: does not count as created here)"
  else
    fail=$((fail + 1))
    echo "  FAIL 20260913000001 was not rejected by name for declaring+invoking a backfill function"
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
  # None of the other EIGHT should hard-reject (::error::) — only
  # 20260913000001 (F2, rule 1) is expected to, plus the three named below
  # (rule 5, spec-88 fase 4): these three are GENUINE, independently-verified
  # historical instances of the exact bug rule 5 exists to catch — CREATE OR
  # REPLACE FUNCTION + GRANT EXECUTE ... TO authenticated with literally zero
  # REVOKE anywhere in the file (`recompute_dispatch_stage`,
  # `get_pre_route_snapshot`, `close_manifest`). They predate rule 5 by
  # weeks; nobody noticed until spec-88's audit (close_manifest was fixed by
  # hand in a LATER migration, 20260913000004/spec-80 fase 1b — not in this
  # list, so this file alone still has the bug). CI never re-scans them
  # (the `ci.yml` step always passes `--base`, so only files ADDED/MODIFIED
  # by a PR are checked) — this full, no-`--base` scan of a fixed file list
  # is the one place they get looked at directly, and hiding them here would
  # defeat the point of rule 5 having found them.
  RULE5_EXPECTED_HITS="20260907000001_spec76_en_bodega_not_dock_ready.sql 20260908000001_spec77_force_split.sql 20260913000002_spec80_close_manifest.sql"
  for name in $TWELVE; do
    if [ "$name" = "20260913000001_spec85_discrepancies_schema.sql" ]; then
      continue
    fi
    case " $RULE5_EXPECTED_HITS " in
      *" $name "*)
        if printf '%s\n' "$output" | grep "::error::" | grep -qF "$name"; then
          pass=$((pass + 1))
          echo "  ok   $name is rejected by rule 5 (genuine GRANT-without-REVOKE, verified by hand)"
        else
          fail=$((fail + 1))
          echo "  FAIL $name was expected to be rejected by rule 5 but was not"
        fi
        continue
        ;;
    esac
    if printf '%s\n' "$output" | grep "::error::" | grep -qF "$name"; then
      fail=$((fail + 1))
      echo "  FAIL $name was unexpectedly rejected"
    fi
  done
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
  # m12 (review round 1): this used to be a silent `skip` (exit 0, "0
  # failed") when the migrations path changed — the exact shape of the
  # fase-1 bug, a fixture that stops being exercised without anyone
  # noticing. If the directory is gone, that's a FAIL, not a skip.
  fail=$((fail + 1))
  echo "  FAIL migrations directory not found at $MIGRATIONS_DIR — the validation set cannot run"
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


# ── B4 (review round 1): --diff-filter=A alone misses a PR that EDITS an
# existing migration's backfill — real precedent: 20260908000001 (added in
# #613, modified in #615), 20260901000001 (modified in #583, "lift
# statement_timeout on the two migration-time backfills"). Two scenarios:
# an already-bad file being touched must not hard-reject (that's 90+
# migrations' worth of legitimate history), but a CLEAN file that a PR
# newly breaks must reject — that is a real, new problem.
GIT_FIXTURE2="$TMP/gitrepo2"
mkdir -p "$GIT_FIXTURE2/migrations"
(
  cd "$GIT_FIXTURE2"
  git init -q
  git config user.email test@example.com
  git config user.name test

  cat > migrations/0000000001_already_bad.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  cat > migrations/0000000002_was_clean.sql <<'SQL'
BEGIN;
ALTER TABLE public.orders ADD COLUMN bar TEXT;
COMMIT;
SQL
  git add -A
  git commit -q -m base

  # Touch the already-bad migration (e.g. lift a statement_timeout) —
  # still has the same pre-existing violation, nothing new introduced.
  cat > migrations/0000000001_already_bad.sql <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30min';
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  # Break the migration that was clean at base — a genuinely new problem.
  cat > migrations/0000000002_was_clean.sql <<'SQL'
BEGIN;
ALTER TABLE public.orders ADD COLUMN bar TEXT;
UPDATE public.orders SET bar = 'baz';
COMMIT;
SQL
  git add -A
  git commit -q -m "touch both migrations"
)
BASE_SHA2=$(cd "$GIT_FIXTURE2" && git rev-parse HEAD~1)
output2=$(cd "$GIT_FIXTURE2" && bash "$SCRIPT" --base "$BASE_SHA2" migrations 2>&1)
actual2=$?
if [ "$actual2" -eq 1 ]; then
  pass=$((pass + 1))
  echo "  ok   --base still rejects a build when an edited file introduces a NEW violation"
else
  fail=$((fail + 1))
  echo "  FAIL --base did not reject a newly-introduced violation in an edited file — expected exit 1, got $actual2"
  printf '%s\n' "$output2" | sed 's/^/         /'
fi
if printf '%s\n' "$output2" | grep "::error::" | grep -qF "already_bad.sql"; then
  fail=$((fail + 1))
  echo "  FAIL --base hard-rejected a pre-existing violation merely being touched (already_bad.sql)"
  printf '%s\n' "$output2" | sed 's/^/         /'
else
  pass=$((pass + 1))
  echo "  ok   --base does not hard-reject a pre-existing violation that was already there at base"
fi
if printf '%s' "$output2" | grep -qF "was_clean.sql"; then
  pass=$((pass + 1))
  echo "  ok   --base names the file that newly broke (was_clean.sql)"
else
  fail=$((fail + 1))
  echo "  FAIL --base did not mention was_clean.sql at all"
  printf '%s\n' "$output2" | sed 's/^/         /'
fi

echo ""
echo "check-migration-safety.sh (real + --base): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
