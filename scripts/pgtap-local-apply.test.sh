#!/usr/bin/env bash
# Self-test for scripts/pgtap-local.sh's `apply` subcommand — the
# content-hash guard added because `apply` used to skip a migration purely
# on its VERSION being present in the ledger, never looking at the file's
# content. A mutant applied to an already-applied version was silently
# skipped: the mutant never reached the database, and any pgTAP test run
# afterward "passed" against the unmutated original. Reproduced by two
# independent agents on 2026-09-10. Round 2 review then found the fix's own
# blind spots — B1/B2/C-3/C-4/C-5 below.
#
# Every assertion proves something against the LIVE DATABASE OBJECT or the
# real exit code / real output text — never just "the command didn't
# error".
#
# Requires a container named $C reachable via `docker exec ... psql`, with
# the pgtap extension installed — nothing else. Never spec52-pg: this test
# writes into /supabase/migrations and the schema_migrations ledger, which
# on the shared local-dev container is live, real migration history other
# worktrees depend on. Use your own throwaway container (matching CI's
# pattern in .github/workflows/ci.yml).
#
# Run from repo root:
#   PGTAP_LOCAL_CONTAINER=<your-own-container> bash scripts/pgtap-local-apply.test.sh
set -uo pipefail

export PGTAP_LOCAL_CONTAINER="${PGTAP_LOCAL_CONTAINER:?set PGTAP_LOCAL_CONTAINER to your OWN throwaway container — never spec52-pg}"
C="$PGTAP_LOCAL_CONTAINER"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="${APPLY_TEST_WRAPPER:-$ROOT/scripts/pgtap-local.sh}"
export MSYS_NO_PATHCONV=1

VER="99999999999901";  FUNC="public.pgtap_apply_selftest_widget"
VER2="99999999999902"; FUNC2="public.pgtap_apply_selftest_widget2"  # B1: unverified backfill
VER4="99999999999904"; FUNC4="public.pgtap_apply_selftest_broken"   # B2: failed=N -> rc!=0
VER5="99999999999905"                                               # C-3: orphaned ledger row
VER6="99999999999910"                                               # C-5: --force regex metachar

MIGFILE="${VER}_pgtap_apply_selftest.sql"
MIGFILE2="${VER2}_pgtap_apply_selftest_unverified.sql"
MIGFILE4="${VER4}_pgtap_apply_selftest_broken.sql"
MIGFILE6="${VER6}_pgtap_apply_selftest.sql"

docker exec "$C" psql -U postgres -d postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "SKIP: container '$C' not reachable" >&2
  exit 1
}
docker exec "$C" mkdir -p /supabase/migrations /supabase/tests

cleanup() {
  docker exec "$C" rm -f "/supabase/migrations/$MIGFILE" "/supabase/migrations/$MIGFILE2" \
    "/supabase/migrations/$MIGFILE4" "/supabase/migrations/$MIGFILE6" >/dev/null 2>&1
  docker exec "$C" psql -U postgres -d postgres -q -c \
    "delete from supabase_migrations.schema_migrations where version in ('$VER','$VER2','$VER4','$VER5','$VER6');
     drop function if exists $FUNC(); drop function if exists $FUNC2(); drop function if exists $FUNC4();" >/dev/null 2>&1
}
trap cleanup EXIT

fails=0
ok() { echo "ok - $1"; }
notok() { echo "not ok - $1"; fails=$((fails+1)); }

live_value() { # $1 = fully-qualified function name
  docker exec "$C" psql -U postgres -d postgres -tAc "select $1()" 2>/dev/null | tr -d ' \r'
}

cleanup  # start from a clean slate in case a previous run was interrupted

# =====================================================================
# Baseline: first apply lands the original; mutate; --force pushes it
# through; --force with a wholly bogus version fails loud.
# =====================================================================
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_v1.sql" "$C:/supabase/migrations/$MIGFILE" >/dev/null ) \
  || { echo "not ok - fixture v1 failed to copy into $C"; exit 1; }
out1=$(bash "$WRAPPER" apply 2>&1)
v1=$(live_value "$FUNC")
if [ "$v1" = "42" ]; then ok "first apply lands the original function (returns 42)"
else notok "first apply lands the original function (got '$v1', output: $out1)"; fi

( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_v2_mutant.sql" "$C:/supabase/migrations/$MIGFILE" >/dev/null ) \
  || { echo "not ok - fixture v2 (mutant) failed to copy into $C"; exit 1; }
out2=$(bash "$WRAPPER" apply 2>&1); rc2=$?
v2=$(live_value "$FUNC")
if printf '%s\n' "$out2" | grep -qF "changed since it was applied"; then
  ok "a mutated file under an already-applied version prints a loud WARNING"
else
  notok "a mutated file under an already-applied version prints a loud WARNING (output: $out2)"
fi
if printf '%s\n' "$out2" | grep -qE 'changed=[1-9]'; then
  ok "the summary line counts it under changed=, not silently under skipped="
else
  notok "the summary line counts it under changed= (output: $out2)"
fi
if [ "$v2" = "42" ]; then
  ok "the mutant is NOT applied without --force (live function still returns 42)"
else
  notok "the mutant is NOT applied without --force (live function returned '$v2' — THE BUG THIS TEST EXISTS TO CATCH)"
fi
# B2: changed=N must make apply's own exit code nonzero.
if [ "$rc2" -ne 0 ]; then
  ok "changed=N alone makes apply exit nonzero (round 2 review, B2)"
else
  notok "changed=N alone makes apply exit nonzero (rc=$rc2 — a caller checking only the exit code sees success)"
fi

out3=$(bash "$WRAPPER" apply --force "$VER" 2>&1); rc3=$?
v3=$(live_value "$FUNC")
if [ "$rc3" -eq 0 ] && [ "$v3" = "999" ]; then
  ok "'apply --force <version>' applies the mutant (live function now returns 999)"
else
  notok "'apply --force <version>' applies the mutant (rc=$rc3, live='$v3', output: $out3)"
fi

out4=$(bash "$WRAPPER" apply --force "00000000000000" 2>&1); rc4=$?
if [ "$rc4" -ne 0 ] && printf '%s\n' "$out4" | grep -qF "matches no file"; then
  ok "'apply --force <bogus-version>' fails loudly instead of doing nothing silently"
else
  notok "'apply --force <bogus-version>' fails loudly (rc=$rc4, output: $out4)"
fi

# =====================================================================
# B1: a ledger row with NO recorded hash (pre-existing, from before this
# guard, or from a bare `up`) must NOT be silently trusted as "matches".
# =====================================================================
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_unverified.sql" "$C:/supabase/migrations/$MIGFILE2" >/dev/null ) \
  || { echo "not ok - fixture unverified failed to copy into $C"; exit 1; }
# Simulate "applied before this guard existed": the ledger says this
# version was applied (name recorded, no content_sha256), and the LIVE
# object is set directly to a value (7) that does NOT match what today's
# file on disk would produce (8) — the exact state where trusting the file
# blindly would canonize whatever is on disk right now, mutant or not.
docker exec "$C" psql -U postgres -d postgres -q -c \
  "create or replace function $FUNC2() returns integer language sql immutable as \$\$ select 7 \$\$;
   insert into supabase_migrations.schema_migrations(version, name) values ('$VER2', '$MIGFILE2');" >/dev/null
out5=$(bash "$WRAPPER" apply 2>&1)
v5=$(live_value "$FUNC2")
if printf '%s\n' "$out5" | grep -qF "no recorded content hash"; then
  ok "a ledger row with no recorded hash prints a loud, distinct WARNING (round 2 review, B1)"
else
  notok "a ledger row with no recorded hash prints a loud, distinct WARNING (output: $out5)"
fi
if printf '%s\n' "$out5" | grep -qE 'unverified=[1-9]'; then
  ok "...and is counted under unverified=, not silently under skipped="
else
  notok "...and is counted under unverified= (output: $out5)"
fi
if [ "$v5" = "7" ]; then
  ok "...and the migration body is NOT executed just because the hash gets backfilled (live still 7, not 8)"
else
  notok "...and the migration body is NOT executed (live='$v5' — backfilling silently ran the file, THE BUG THIS GUARD EXISTS TO CATCH)"
fi

# =====================================================================
# B2: a real apply FAILURE must also make the exit code nonzero — the
# repro that motivated this whole PR was literally "failed=3" with rc=0.
# =====================================================================
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_broken.sql" "$C:/supabase/migrations/$MIGFILE4" >/dev/null ) \
  || { echo "not ok - fixture broken failed to copy into $C"; exit 1; }
out6=$(bash "$WRAPPER" apply 2>&1); rc6=$?
if [ "$rc6" -ne 0 ] && printf '%s\n' "$out6" | grep -qE 'failed=[1-9]'; then
  ok "a migration that fails to apply makes apply exit nonzero, not just print failed=N (round 2 review, B2)"
else
  notok "a migration that fails to apply makes apply exit nonzero (rc=$rc6, output: $out6)"
fi
docker exec "$C" rm -f "/supabase/migrations/$MIGFILE4"  # stop it failing every subsequent apply in this run

# =====================================================================
# C-3: a ledger row whose migration file was renamed/deleted must be
# surfaced (ledger -> file direction), not just file -> ledger.
# =====================================================================
docker exec "$C" psql -U postgres -d postgres -q -c \
  "insert into supabase_migrations.schema_migrations(version, name, content_sha256) values ('$VER5', 'a_deleted_migration.sql', 'deadbeef');" >/dev/null
out7=$(bash "$WRAPPER" apply 2>&1)
if printf '%s\n' "$out7" | grep -qF "$VER5" && printf '%s\n' "$out7" | grep -qE 'orphaned=[1-9]'; then
  ok "a ledger row with no matching file is surfaced as orphaned=N, not invisible (round 2 review, C-3)"
else
  notok "a ledger row with no matching file is surfaced as orphaned=N (output: $out7)"
fi

# =====================================================================
# C-5: --force must compare the version LITERALLY, not as a grep pattern.
# A regex metacharacter in the argument must not "match" a real version
# that isn't actually equal to it.
# =====================================================================
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_v1.sql" "$C:/supabase/migrations/$MIGFILE6" >/dev/null ) \
  || { echo "not ok - fixture v1 (for C-5) failed to copy into $C"; exit 1; }
bash "$WRAPPER" apply >/dev/null 2>&1  # get $VER6 genuinely applied first
# "9999999999991." (literal dot replacing the real version's last digit)
# — under a PATTERN-based check this "matches" $VER6 (the dot stands for
# any character), even though it is not equal to it as a string.
out8=$(bash "$WRAPPER" apply --force "9999999999991." 2>&1); rc8=$?
if [ "$rc8" -ne 0 ] && printf '%s\n' "$out8" | grep -qF "matches no file"; then
  ok "'apply --force' with a regex-metacharacter version fails loud, doesn't silently no-op (round 2 review, C-5)"
else
  notok "'apply --force' with a regex-metacharacter version fails loud (rc=$rc8, output: $out8)"
fi

# =====================================================================
# C-4: apply against a container nobody ever `sync`ed must fail loud, not
# print an all-zero "success" indistinguishable from a genuinely clean run.
# =====================================================================
docker exec "$C" bash -c 'mv /supabase/migrations /supabase/migrations.selftest-bak && mkdir /supabase/migrations'
out9=$(bash "$WRAPPER" apply 2>&1); rc9=$?
docker exec "$C" bash -c 'rmdir /supabase/migrations 2>/dev/null; mv /supabase/migrations.selftest-bak /supabase/migrations'
if [ "$rc9" -ne 0 ] && printf '%s\n' "$out9" | grep -qF "run 'sync' first"; then
  ok "apply against an unsynced (empty migrations dir) container fails loud (round 2 review, C-4)"
else
  notok "apply against an unsynced container fails loud (rc=$rc9, output: $out9)"
fi

if [ "$fails" -eq 0 ]; then
  echo "── pgtap-local-apply.test.sh: PASS ──"
  exit 0
else
  echo "── pgtap-local-apply.test.sh: FAIL ($fails) ──"
  exit 1
fi
