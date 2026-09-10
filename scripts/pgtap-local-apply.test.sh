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
# WARNING (round 6 review): the real-migrations stability section near the
# end DESTROYS and REBUILDS $C from scratch (`docker rm -f` + recreate,
# via `bash ./scripts/pgtap-local.sh up`) — needed to test against the
# real 200+ migration set with a real bootstrap, not just pgtap. If $C
# holds anything you care about, this test discards it. Rebuild ~1-5 min.
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
# Round 4 review, item 7: never a real migration filename/version, even if
# this test is pointed at the wrong container by mistake — the allowlist
# guard is exercised through PGTAP_APPLY_TEST_ALLOWLIST_ENTRY (round 4
# review, B1/item 7), a throwaway entry appended only when this env var is
# set, never touching KNOWN_BASE_IMAGE_FAILURES itself.
VER_ALLOW="99999999999920"
VER7="99999999999930"; FUNC7="public.pgtap_apply_selftest_widget3"       # item 1: BEGIN; no COMMIT;

MIGFILE="${VER}_pgtap_apply_selftest.sql"
MIGFILE2="${VER2}_pgtap_apply_selftest_unverified.sql"
MIGFILE4="${VER4}_pgtap_apply_selftest_broken.sql"
MIGFILE6="${VER6}_pgtap_apply_selftest.sql"
MIGFILE_ALLOW="${VER_ALLOW}_pgtap_apply_selftest_allowlist.sql"
MIGFILE7="${VER7}_pgtap_apply_selftest_begin_no_commit.sql"
ALLOWLIST_MARKER='pgtap apply selftest allowlist marker'
ALLOWLIST_ENTRY_GOOD="${MIGFILE_ALLOW}|${ALLOWLIST_MARKER}"
ALLOWLIST_ENTRY_MISMATCHED="${MIGFILE_ALLOW}|this text will never appear in the real error"

docker exec "$C" psql -U postgres -d postgres -tAc "select 1" >/dev/null 2>&1 || {
  echo "SKIP: container '$C' not reachable" >&2
  exit 1
}
docker exec "$C" mkdir -p /supabase/migrations /supabase/tests

cleanup() {
  docker exec "$C" rm -f "/supabase/migrations/$MIGFILE" "/supabase/migrations/$MIGFILE2" \
    "/supabase/migrations/$MIGFILE4" "/supabase/migrations/$MIGFILE6" "/supabase/migrations/$MIGFILE_ALLOW" \
    "/supabase/migrations/$MIGFILE7" >/dev/null 2>&1
  docker exec "$C" psql -U postgres -d postgres -q -c \
    "delete from supabase_migrations.schema_migrations where version in ('$VER','$VER2','$VER4','$VER5','$VER6','$VER_ALLOW','$VER7');
     drop function if exists $FUNC(); drop function if exists $FUNC2(); drop function if exists $FUNC4(); drop function if exists $FUNC7();" >/dev/null 2>&1
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
out5=$(bash "$WRAPPER" apply 2>&1); rc5=$?
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
# Round 3 review, B1: unverified > 0 is the DANGEROUS outcome and must fail
# the run too, same as changed and failed — round 2 left it at rc=0.
if [ "$rc5" -ne 0 ]; then
  ok "unverified=N alone makes apply exit nonzero (round 3 review, B1)"
else
  notok "unverified=N alone makes apply exit nonzero (rc=$rc5 — a caller checking only the exit code sees success)"
fi

# =====================================================================
# Round 3 review, B2: round 2's backfill went QUIET after one run — the
# second `apply` invocation, with the exact same file still on disk,
# reported a perfectly clean run (skipped=1, everything else zero, rc=0)
# while the database still held the ORIGINAL, unverified content. Run
# apply a SECOND time against the same still-unresolved row and demand it
# is JUST AS NOISY, not quieter.
# =====================================================================
out5b=$(bash "$WRAPPER" apply 2>&1); rc5b=$?
v5b=$(live_value "$FUNC2")
if printf '%s\n' "$out5b" | grep -qF "still UNVERIFIED"; then
  ok "a second apply run on the same unresolved row is STILL noisy, not silently 'skipped' (round 3 review, B2)"
else
  notok "a second apply run on the same unresolved row is still noisy (output: $out5b — THE BUG THIS TEST EXISTS TO CATCH: round 2 went quiet here)"
fi
if printf '%s\n' "$out5b" | grep -qE 'unverified=[1-9]'; then
  ok "...still counted under unverified=, never silently folded into skipped="
else
  notok "...still counted under unverified= (output: $out5b)"
fi
if [ "$rc5b" -ne 0 ]; then
  ok "...and the second run's exit code is still nonzero"
else
  notok "...and the second run's exit code is still nonzero (rc=$rc5b)"
fi
if [ "$v5b" = "7" ]; then
  ok "...and the live object is still untouched (7) two runs later"
else
  notok "...and the live object is still untouched two runs later (live='$v5b')"
fi

# Round 4 review, item 6: an unverified row that changes AGAIN (a third
# version of the file, still never applied) must say so specifically, not
# just repeat the generic "still UNVERIFIED" message — the comparison
# against the hash recorded alongside the "unverified:" marker must
# actually run, not just detect the prefix and stop looking.
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_unverified_v2.sql" "$C:/supabase/migrations/$MIGFILE2" >/dev/null ) \
  || { echo "not ok - fixture unverified v2 failed to copy into $C"; exit 1; }
out5c=$(bash "$WRAPPER" apply 2>&1)
v5c=$(live_value "$FUNC2")
if printf '%s\n' "$out5c" | grep -qF "AND changed again"; then
  ok "an unverified row that changes again gets a MORE specific message, not the generic one (round 4 review, item 6)"
else
  notok "an unverified row that changes again gets a more specific message (output: $out5c)"
fi
if [ "$v5c" = "7" ]; then
  ok "...and it is still not applied (live still 7)"
else
  notok "...and it is still not applied (live='$v5c')"
fi

# This row is now PERSISTENTLY unverified by design — every apply on this
# container from here on would otherwise report unverified=1 and rc!=0,
# unrelated to whatever the rest of this script is testing. Clean it up so
# later sections run against a clean world again (a real container would
# need `up`, not this — the self-test just resets its own fixture).
docker exec "$C" rm -f "/supabase/migrations/$MIGFILE2"
docker exec "$C" psql -U postgres -d postgres -q -c \
  "delete from supabase_migrations.schema_migrations where version = '$VER2'; drop function if exists $FUNC2();" >/dev/null

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
# Round 3/4 review, B1: a failure on the allowlist must NOT make apply
# exit nonzero — forcing `up` (which ends with `apply`) to fail on every
# machine, forever, for base-image gaps nobody can fix teaches everyone to
# bolt on `|| true`, which cancels this whole guard. Exercised through
# PGTAP_APPLY_TEST_ALLOWLIST_ENTRY, never a real KNOWN_BASE_IMAGE_FAILURES
# entry or a real migration filename.
# =====================================================================
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_allowlist_marker.sql" "$C:/supabase/migrations/$MIGFILE_ALLOW" >/dev/null ) \
  || { echo "not ok - fixture allowlist_marker failed to copy into $C"; exit 1; }
out6b=$(PGTAP_APPLY_TEST_ALLOWLIST_ENTRY="$ALLOWLIST_ENTRY_GOOD" bash "$WRAPPER" apply 2>&1); rc6b=$?
if [ "$rc6b" -eq 0 ] && printf '%s\n' "$out6b" | grep -qF "known base-image gap"; then
  ok "a failure matching BOTH filename and error text on the allowlist does NOT fail the run (round 3/4 review, B1)"
else
  notok "an allowlisted failure (name+text match) does not fail the run (rc=$rc6b, output: $out6b)"
fi
docker exec "$C" psql -U postgres -d postgres -q -c \
  "delete from supabase_migrations.schema_migrations where version = '$VER_ALLOW';" >/dev/null

# Round 4 review, B1: the allowlist matches on filename AND error text —
# same filename, DIFFERENT (unexpected) error text must NOT be silently
# waved through. This is the exact vulnerability the review measured:
# injecting an unrelated new failure into an allowlisted file and getting
# rc=0 anyway.
out6c=$(PGTAP_APPLY_TEST_ALLOWLIST_ENTRY="$ALLOWLIST_ENTRY_MISMATCHED" bash "$WRAPPER" apply 2>&1); rc6c=$?
docker exec "$C" rm -f "/supabase/migrations/$MIGFILE_ALLOW"
docker exec "$C" psql -U postgres -d postgres -q -c \
  "delete from supabase_migrations.schema_migrations where version = '$VER_ALLOW';" >/dev/null
if [ "$rc6c" -ne 0 ] && printf '%s\n' "$out6c" | grep -qE '^FAIL 99999999999920' ; then
  ok "a filename match with DIFFERENT error text is NOT allowlisted — still a real failure (round 4 review, B1)"
else
  notok "a filename match with different error text still fails the run (rc=$rc6c, output: $out6c)"
fi

# Round 4 review, item 5: an allowlist entry that never gets a chance to
# match this run (no file with that name present at all) must be named in
# a NOTE — a stale/dead entry is still silently covering that filename.
out6d=$(PGTAP_APPLY_TEST_ALLOWLIST_ENTRY="$ALLOWLIST_ENTRY_GOOD" bash "$WRAPPER" apply 2>&1)
if printf '%s\n' "$out6d" | grep -qF "NOTE: KNOWN_BASE_IMAGE_FAILURES entry never matched this run: $MIGFILE_ALLOW"; then
  ok "an allowlist entry that never fires this run is named in a NOTE (round 4 review, item 5)"
else
  notok "an unmatched allowlist entry is named in a NOTE (output: $out6d)"
fi

# =====================================================================
# Round 5 review, medium: a malformed allowlist entry — no '|' separator,
# or an empty expected-error text — must be REJECTED loudly, not silently
# degrade the whole guard back to filename-only matching (that's the B1
# vulnerability again, reachable through a typo instead of a mutant).
# =====================================================================
out6e=$(PGTAP_APPLY_TEST_ALLOWLIST_ENTRY="9999999999901_malformed_no_pipe.sql" bash "$WRAPPER" apply 2>&1); rc6e=$?
if [ "$rc6e" -ne 0 ] && printf '%s\n' "$out6e" | grep -qF "no '|' separator"; then
  ok "a malformed allowlist entry with no '|' separator is rejected loudly (round 5 review, medium)"
else
  notok "a malformed allowlist entry with no '|' separator is rejected loudly (rc=$rc6e, output: $out6e)"
fi

out6f=$(PGTAP_APPLY_TEST_ALLOWLIST_ENTRY="9999999999902_malformed_empty_expect.sql|" bash "$WRAPPER" apply 2>&1); rc6f=$?
if [ "$rc6f" -ne 0 ] && printf '%s\n' "$out6f" | grep -qF "empty expected error text"; then
  ok "a malformed allowlist entry with empty expected error text is rejected loudly (round 5 review, medium)"
else
  notok "a malformed allowlist entry with empty expected error text is rejected loudly (rc=$rc6f, output: $out6f)"
fi

# =====================================================================
# Round 6 review, item 4: PGTAP_APPLY_TEST_ALLOWLIST_ENTRY must be
# restricted BY CONSTRUCTION, not by a WARNING alone — refuse it outright
# if the version it names is shaped like a REAL migration (this repo's
# real migrations all start with a 20YYMMDDHHMMSS timestamp), even though
# no file with this exact fake-but-real-shaped name exists anywhere. The
# check is on the name's SHAPE, not on disk presence — deliberately: this
# script's OWN legitimate fixtures under the 9999999999xx sentinel range
# DO exist on disk (that's how they test real error-text matching), so
# "exists on disk" can't distinguish a throwaway fixture from a real
# migration the way the version range can.
# =====================================================================
out6g=$(PGTAP_APPLY_TEST_ALLOWLIST_ENTRY="20990101000000_totally_fake_but_real_shaped.sql|anything" bash "$WRAPPER" apply 2>&1); rc6g=$?
if [ "$rc6g" -ne 0 ] && printf '%s\n' "$out6g" | grep -qF "outside the 9999999999xx test-only sentinel range"; then
  ok "PGTAP_APPLY_TEST_ALLOWLIST_ENTRY naming a real-shaped version is refused, not just warned about (round 6 review, item 4)"
else
  notok "PGTAP_APPLY_TEST_ALLOWLIST_ENTRY naming a real-shaped version is refused (rc=$rc6g, output: $out6g)"
fi

# =====================================================================
# Round 6 review, item 1: a migration with its own top-level BEGIN; and no
# matching top-level COMMIT; must print the SAME warning
# infra/supabase-qa/apply-migrations.sh already carries for this exact
# shape (copied verbatim) — this harness inherited the BEGIN exception
# from that script without inheriting the warning next to it.
# =====================================================================
( cd "$ROOT" && docker cp "scripts/pgtap-local-fixtures/apply_selftest_begin_no_commit.sql" "$C:/supabase/migrations/$MIGFILE7" >/dev/null ) \
  || { echo "not ok - fixture begin_no_commit failed to copy into $C"; exit 1; }
out_bc=$(bash "$WRAPPER" apply 2>&1)
if printf '%s\n' "$out_bc" | grep -qF "has a top-level BEGIN; but no matching top-level COMMIT;"; then
  ok "a migration with BEGIN; and no matching COMMIT; prints the apply-migrations.sh warning (round 6 review, item 1)"
else
  notok "a migration with BEGIN; and no COMMIT; prints the warning (output: $out_bc)"
fi

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

# =====================================================================
# Round 5 review: apply must be STABLE across repeated invocations against
# the REAL migration set, on the SAME container — no mutation needed. This
# was reachable on a pristine repo with zero mutant involved: a real
# migration's error text (not its pass/fail status — its actual wording)
# depended on migration-APPLICATION ORDER, which a `-c`-only allowlist
# comparison can't express with one static string. Neither CI (which only
# exercises isolated fixtures, never the real migrations) nor the earlier
# rounds of this test caught it — this is the seam that bit twice.
# Rebuilds THIS container from scratch via `up` (so it's fully bootstrapped
# — auth shims, pgtap — not just pgtap, which is all the rest of this file
# needs), which is also the very first `apply` invocation, then applies
# twice more and requires all three runs agree.
# =====================================================================
out_u=$(bash "$WRAPPER" up 2>&1); rc_u=$?
out_a2=$(bash "$WRAPPER" apply 2>&1); rc_a2=$?
out_a3=$(bash "$WRAPPER" apply 2>&1); rc_a3=$?
if [ "$rc_u" -eq "$rc_a2" ] && [ "$rc_a2" -eq "$rc_a3" ]; then
  ok "apply against the REAL migration set gives the SAME exit code across repeated runs on one container (round 5 review)"
else
  notok "apply is stable across repeated runs on the real migration set (rc(up)=$rc_u rc(apply#2)=$rc_a2 rc(apply#3)=$rc_a3; up output: $out_u; #2: $out_a2; #3: $out_a3)"
fi
if [ "$rc_u" -eq 0 ]; then
  ok "...and that stable exit code is 0 (no unexpected failures, no drift, nothing unverified)"
else
  notok "...and that stable exit code is 0 (rc=$rc_u, up output: $out_u)"
fi
# Round 5 review: catches a DEAD real allowlist entry too — e.g. an entry
# for a migration that now applies cleanly (as spec30_dashboard_rpcs.sql
# does after the -1 fix) left in KNOWN_BASE_IMAGE_FAILURES by mistake.
if ! printf '%s\n' "$out_u" | grep -q "NOTE:"; then
  ok "...and every real KNOWN_BASE_IMAGE_FAILURES entry actually fires — none are dead"
else
  notok "...and every real allowlist entry fires (output: $out_u)"
fi

if [ "$fails" -eq 0 ]; then
  echo "── pgtap-local-apply.test.sh: PASS ──"
  exit 0
else
  echo "── pgtap-local-apply.test.sh: FAIL ($fails) ──"
  exit 1
fi
