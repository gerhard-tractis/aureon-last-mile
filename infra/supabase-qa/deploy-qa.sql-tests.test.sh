#!/usr/bin/env bash
#
# Tests for sql_tests_check() in deploy-qa.sh.
#
# spec-92 review round 3: sql_tests_check runs ONE psql PROCESS PER FILE
# (packages/database/supabase/tests/*.sql, most using plain RAISE
# EXCEPTION, some using pgTAP's plan()/finish() — a hardcoded file count in
# this comment went stale twice already, rounds 3 and 5) instead of round
# 2's one-connection-many-\i design. See
# the function's own comment in deploy-qa.sh for why: round 2 grew a new
# false-"ok" disguise on every review round (B1: stderr ERROR flushed
# outside its BEGIN/END section; B2: the fix for B1 added a diagnostic
# pipeline that could itself die under `set -e`; M6/M7: an unopenable file
# or a stray metacommand error matched no guard, or landed in a
# NEIGHBOR's section). One psql invocation per file removes the merged
# stream there was ever anything to misattribute within — $rc decides
# directly for anything that raises (RAISE EXCEPTION, a bad metacommand, an
# unreadable file), and a per-file content check (against that file's own,
# untouched output only) catches pgTAP's `not ok`, which never raises.
#
# a real SQL test failure now flips RESULT and fails the deploy, same as
# any other record()'d check. What stays advisory is ONLY the absence of
# something needed to run the tests at all, never a test result: missing
# POSTGRES_PASSWORD, a missing tests dir, no *.sql files in it, the
# pgtap-installed PROBE failing outright, or a single file being skipped
# because pgtap isn't installed (SKIPPED-NO-PGTAP) — that last one is
# covered separately by ensure_pgtap()'s own CREATE-EXTENSION degraded-
# streak escalation (QA_PGTAP_DEGRADED_MAX), not duplicated here.
#
# These tests stub `psql` so the behaviour is verifiable without a VPS or a
# real database. The HARNESS built by build_harness() below runs under
# `set -Eeuo pipefail` — matching deploy-qa.sh:57 EXACTLY (round 3's B3: a
# harness running the extracted function under weaker flags than the real
# script cannot see a `set -e`-triggered abort bug in that function at all —
# that is why B2 survived two earlier rounds unnoticed). This OUTER driver
# script deliberately stays under the weaker `set -uo pipefail` (no -e): it
# repeatedly does `out="$(inner-command)"; rc=$?` specifically so a bug in
# the harness/function under test shows up as a wrong `rc`/`out` for one
# `check`, not as this whole driver silently exiting before printing every
# other test's result — the harness is where B3's fix belongs, not here.
#
# Run: bash infra/supabase-qa/deploy-qa.sql-tests.test.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

pass=0
fail=0

check() { # $1 name, $2 expected, $3 actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1 — expected '$2', got '$3'"
  fi
}

check_true() { # $1 name, $2 condition result (0/1)
  if [ "$2" -eq 0 ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1"
  fi
}

# A `psql` stub that fakes both invocations sql_tests_check makes, and logs
# the REAL argv of every call to PSQL_CALLS (one line per call — this is
# what H5's count-floor assertions and H2's ON_ERROR_STOP assertion read)
# plus the two env vars m1 added (PGOPTIONS, PGCONNECT_TIMEOUT) to
# PSQL_ENV_LOG so m3 can assert they actually reach psql. Round 4 (H2): the
# previous version of this stub wrote only the literal string "CALLED",
# while its own comment claimed it logged "every call's argv" — nothing
# ever verified `-v ON_ERROR_STOP=1` (the mechanism's own load-bearing
# flag) actually reached psql; deleting it from deploy-qa.sh passed 40/40.
#
#   1. `-tAc "SELECT 1 FROM pg_extension ..."` (the pgtap probe) -> prints
#      PGTAP_INSTALLED on STDOUT. PSQL_PROBE_FAIL simulates the probe
#      itself failing to run at all (M2). PSQL_PROBE_STDERR_NOISE writes a
#      harmless NOTICE to STDERR while still succeeding — M5: this must
#      NOT change what pgtap_ok decides, only stdout may.
#   2. `-f <path>` (one test file) -> decided by the fixture's basename,
#      never by reading the file (control-flow test, not a SQL test):
#        *pass*        -> ordinary output, exit 0
#        *error*       -> a RAISE-EXCEPTION-shaped psql error, exit nonzero
#                         (ON_ERROR_STOP=1's real behaviour)
#        *tapfail*     -> a pgTAP "not ok" row on STDOUT, exit 0 (pgTAP
#                         never raises — content must decide)
#        *planmismatch* -> pgTAP's OWN "planned N but ran M" diagnostic
#                         (H4/B1), emitted in psql's REAL default ALIGNED
#                         result-set format: a header, a "----" separator,
#                         the diagnostic as a DATA ROW (psql prepends one
#                         space to every data row — this is the exact shape
#                         round 4's fixture got wrong by printing the
#                         string in column 0, which is why round 4's
#                         mutation test could not catch B1: the `^` anchor
#                         never had anything real to fail against), and a
#                         "(1 row)" footer. No "not ok" anywhere, exit 0.
#        *bigtap*      -> B2: a `not ok 1` on almost the FIRST line,
#                         followed by ~40000 "ok N" rows — pgTAP's own
#                         format, well past a `grep -q`'s first-match/
#                         SIGPIPE danger zone, and specifically front-
#                         loaded so a first-match-then-quit reader hits it
#                         almost immediately, while output is still being
#                         written.
#        *notfound*    -> psql could not even open the file (M6), exit
#                         nonzero, lowercase "error:" text
#        *bigfail*     -> H1/H3: ~5000 lines of filler BEFORE the real
#                         ERROR: line at the very end (matching real
#                         ON_ERROR_STOP=1 psql, which prints every prior
#                         result set before the statement that aborted),
#                         well past the ~64KiB pipe-buffer size a `head`
#                         in the FAIL branch could SIGPIPE on
#      PSQL_CONN_FAIL forces EVERY per-file call to fail as a connection
#      refusal, regardless of fixture — the "total outage" case, which
#      under this design just means every file's own $rc is nonzero; there
#      is no longer a marker/section guard needed to catch it.
cat > "$STUB_DIR/psql" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PSQL_CALLS"
printf 'PGOPTIONS=%s PGCONNECT_TIMEOUT=%s\n' "${PGOPTIONS:-}" "${PGCONNECT_TIMEOUT:-}" >> "$PSQL_ENV_LOG"
args=("$@")
target=""
tac=0
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -f) target="${args[$((i + 1))]}" ;;
    -tAc) tac=1 ;;
  esac
done

if [ "$tac" -eq 1 ]; then
  if [ "${PSQL_PROBE_FAIL:-}" = "1" ]; then
    echo "psql: error: connection to server at \"localhost\", port 5433 failed: Connection refused" >&2
    exit 2
  fi
  if [ "${PSQL_PROBE_STDERR_NOISE:-}" = "1" ]; then
    echo "NOTICE:  a harmless notice psql wrote to stderr" >&2
  fi
  printf '%s' "${PGTAP_INSTALLED:-}"
  exit 0
fi

if [ -n "$target" ]; then
  if [ "${PSQL_CONN_FAIL:-}" = "1" ]; then
    echo "psql: error: connection to server at \"localhost\", port 5433 failed: Connection refused" >&2
    exit 2
  fi
  base="$(basename "$target")"
  case "$base" in
    *notfound*)
      echo "psql: error: ${target}: No such file or directory" >&2
      exit 1
      ;;
    *bigfail*)
      i=0
      while [ "$i" -lt 5000 ]; do
        echo "NOTICE:  filler output line $i of a big test file"
        i=$((i + 1))
      done
      echo "ERROR:  the real failure, at the very end"
      exit 3
      ;;
    *planmismatch*)
      # Real psql ALIGNED result-set format (no -A/-t on this call): a
      # header, a "----" separator, ONE SPACE before the data row, and a
      # row-count footer. finish()'s diagnostic is a plain text row, not a
      # log line — it never starts in column 0.
      printf '                   finish                   \n'
      printf -- '--------------------------------------------\n'
      printf ' # Looks like you planned 5 tests but ran 3\n'
      printf '(1 row)\n'
      printf '\n'
      exit 0
      ;;
    *bigtap*)
      printf '                   finish                   \n'
      printf -- '--------------------------------------------\n'
      printf ' not ok 1 - fixture says fail\n'
      i=0
      while [ "$i" -lt 40000 ]; do
        printf ' ok %d - fixture filler\n' "$i"
        i=$((i + 1))
      done
      printf '(40001 rows)\n'
      exit 0
      ;;
    *error*)
      echo "psql:${target}:2: ERROR:  boom" >&2
      exit 3
      ;;
    *tapfail*)
      echo "not ok 1 - fixture says fail"
      exit 0
      ;;
    *)
      echo "(pretend passing output)"
      exit 0
      ;;
  esac
fi
exit 0
STUB
chmod +x "$STUB_DIR/psql"
export PATH="$STUB_DIR:$PATH"

# Fixture test files. Content is irrelevant to the stub (it decides by
# filename), except the `plan(` sniff sql_tests_check itself does to route
# pgTAP-vs-not, which must match real files' shape.
FIXTURES="$STUB_DIR/fixtures"
mkdir -p "$FIXTURES"
cat > "$FIXTURES/aaa_pass_test.sql" <<'SQL'
BEGIN;
SELECT 1;
ROLLBACK;
SQL
cat > "$FIXTURES/bbb_error_test.sql" <<'SQL'
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
ROLLBACK;
SQL
cat > "$FIXTURES/ccc_tapfail_test.sql" <<'SQL'
BEGIN;
SELECT plan(1);
SELECT ok(false, 'deliberately fails');
SELECT * FROM finish();
ROLLBACK;
SQL
cat > "$FIXTURES/ddd_notfound_test.sql" <<'SQL'
BEGIN;
SELECT 1;
ROLLBACK;
SQL
cat > "$FIXTURES/eee_bigfail_test.sql" <<'SQL'
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'boom, eventually'; END $$;
ROLLBACK;
SQL
cat > "$FIXTURES/fff_planmismatch_test.sql" <<'SQL'
BEGIN;
SELECT plan(5);
SELECT ok(true, 'only one of the planned five actually ran');
SELECT * FROM finish();
ROLLBACK;
SQL
cat > "$FIXTURES/zzz_after_test.sql" <<'SQL'
BEGIN;
SELECT 1;
ROLLBACK;
SQL
cat > "$FIXTURES/ggg_bigtap_test.sql" <<'SQL'
BEGIN;
SELECT plan(40001);
SELECT ok(false, 'fails almost immediately');
SELECT ok(true, 'filler') FROM generate_series(1, 40000);
SELECT * FROM finish();
ROLLBACK;
SQL

export QA_CHECKOUT_DIR="$STUB_DIR/qa"
export QA_ENV_FILE="$STUB_DIR/.env.qa"
mkdir -p "$QA_CHECKOUT_DIR/packages/database/supabase/tests"
cp "$FIXTURES/aaa_pass_test.sql" "$FIXTURES/bbb_error_test.sql" "$FIXTURES/ccc_tapfail_test.sql" \
  "$QA_CHECKOUT_DIR/packages/database/supabase/tests/"
printf 'POSTGRES_PASSWORD=s3cret\n' > "$QA_ENV_FILE"

# Source only the pieces under test, so sourcing cannot trigger the script's
# own setup. Mirrors deploy-qa.seed.test.sh / deploy-qa.guard-sudo.test.sh.
extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
# m3 (round 3): pull QA_SQL_STATEMENT_TIMEOUT_MS/QA_SQL_CONNECT_TIMEOUT_SEC's
# default straight out of the real script instead of re-typing "30000"/"10"
# here by hand. If a future edit deletes that declaration from deploy-qa.sh,
# extract_var returns nothing and the harness never defines the variable.
# Referencing it under `set -u` happens inside a `$( )` command
# substitution (the probe's or a per-file psql call), so the unbound-
# variable error kills that SUBSHELL, not sql_tests_check() itself — the
# surrounding `&& rc=0 || rc=$?` guard (deliberately present for exactly
# this kind of nonzero-exit capture) catches it and records it as a
# regular probe/per-file FAIL. Still loud (a FAIL row, not a silent pass),
# just not a hard abort of the whole function — corrected in round 4 (H9)
# after the original wording overclaimed the failure mode.
extract_var() { grep -m1 "^$1=" "$HERE/deploy-qa.sh"; }
build_harness() {
  {
    echo "set -Eeuo pipefail"
    echo "QA_CHECKOUT_DIR=\"$QA_CHECKOUT_DIR\""
    echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
    extract_var QA_SQL_STATEMENT_TIMEOUT_MS
    extract_var QA_SQL_CONNECT_TIMEOUT_SEC
    echo "CHECKS=()"
    echo "RESULT=0"
    extract log
    extract err
    extract env_get
    extract record
    extract record_advisory
    extract sql_tests_check
  } > "$STUB_DIR/harness.sh"
}
build_harness

echo "sql_tests_check()"

run() { # $1 = extra env prefix (as a single string, word-split), $2 = QA_CHECKOUT_DIR override or ""
  local checkout="${2:-$QA_CHECKOUT_DIR}"
  env $1 QA_CHECKOUT_DIR="$checkout" bash -c \
    '. "'"$STUB_DIR"'/harness.sh"; QA_CHECKOUT_DIR="'"$checkout"'"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"'
}

# ── Normal run, pgtap NOT installed on QA ───────────────────────────────────
PSQL_CALLS="$STUB_DIR/calls1"; export PSQL_CALLS; : > "$PSQL_CALLS"
PSQL_ENV_LOG="$STUB_DIR/env1"; export PSQL_ENV_LOG; : > "$PSQL_ENV_LOG"
output1="$(run 'PGTAP_INSTALLED=' 2>&1)"; rc=$?
check_true "runs to completion (exit 0) with pgtap absent" $rc
check "RESULT flips to 1 because the RAISE EXCEPTION file really failed" \
  "RESULT=1" "$(printf '%s\n' "$output1" | grep '^RESULT=')"
check "the RAISE EXCEPTION file is reported FAIL" \
  "sql: bbb_error_test.sql|FAIL|see the block above this table" \
  "$(printf '%s\n' "$output1" | grep '^sql: bbb_error_test.sql')"
check "the clean file is reported ok" \
  "sql: aaa_pass_test.sql|ok|" \
  "$(printf '%s\n' "$output1" | grep '^sql: aaa_pass_test.sql')"
check "the pgTAP file is SKIPped, not run, when pgtap is not installed" \
  "sql: ccc_tapfail_test.sql|SKIP|pgtap extension not installed on QA" \
  "$(printf '%s\n' "$output1" | grep '^sql: ccc_tapfail_test.sql')"
# m3 (round 3): the two m1 timeouts actually reach every psql invocation,
# pulled live from the script's own default (see extract_var above), not
# re-typed by hand — deleting the declaration from deploy-qa.sh makes the
# harness itself fail to build (set -u), which every check_true above would
# already have caught; these two assert the VALUE actually lands on psql's
# environment, not just that some variable exists somewhere in the shell.
check "PSQL_ENV_LOG has one line per psql call, none missing PGCONNECT_TIMEOUT" \
  "true" "$([ -s "$PSQL_ENV_LOG" ] && ! grep -q 'PGCONNECT_TIMEOUT=$' "$PSQL_ENV_LOG" && echo true)"
check "every psql call carries PGOPTIONS with a numeric statement_timeout" \
  "true" "$([ -s "$PSQL_ENV_LOG" ] && ! grep -qv 'PGOPTIONS=-c statement_timeout=[0-9][0-9]*' "$PSQL_ENV_LOG" && echo true)"

# ── H2 (round 4): -v ON_ERROR_STOP=1 is the load-bearing flag the ENTIRE
#    redesign stands on — it is what turns a RAISE EXCEPTION into a nonzero
#    $rc at all. Nothing asserted it reached psql before this: the stub
#    only ever logged the string "CALLED", so deleting the flag from
#    deploy-qa.sh passed 40/40. PSQL_CALLS now holds the real argv (see the
#    stub above), so this greps for it directly on the per-file calls
#    (lines containing " -f ") ────────────────────────────────────────────
check "every per-file psql call carries -v ON_ERROR_STOP=1" \
  "true" "$([ -s "$PSQL_CALLS" ] && ! grep -- ' -f ' "$PSQL_CALLS" | grep -qv -- '-v ON_ERROR_STOP=1' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)

# ── H5 (round 4), secondary check only — see the REAL floor assertion in
#    the pgtap-installed block above (H5/M1, round 5) for why. In THIS
#    config (pgtap absent) ccc is SKIPped without calling psql at all, so
#    this "3" cannot by itself distinguish "ran aaa+bbb correctly, skipped
#    ccc" from "silently truncated the list to [aaa, bbb] and never looked
#    at ccc" — both produce the same count here. Kept as a sanity check on
#    THIS specific config (it does still catch e.g. a double-call bug),
#    not as the count-floor guarantee ─────────────────────────────────────
check "exactly one psql call per file that needed one in THIS config, plus the probe" \
  "3" "$(wc -l < "$PSQL_CALLS" | tr -d ' ')"

# ── M7 eliminated by construction: with a FAIL (bbb) and an ok (aaa) file in
#    the SAME run, aaa's own separate psql invocation cannot be touched by
#    bbb's — already asserted above ("the clean file is reported ok" in the
#    same run as bbb's FAIL); restated here as its own named check so a
#    future regression that reintroduces shared state fails a test whose
#    name says why it matters ─────────────────────────────────────────────
check "M7: an unrelated file in the same run is untouched by another file's failure" \
  "sql: aaa_pass_test.sql|ok|" \
  "$(printf '%s\n' "$output1" | grep '^sql: aaa_pass_test.sql')"

# ── pgtap IS installed on QA: the same pgTAP file now actually "runs" and
#    its `not ok` line must be caught even though nothing raised (rc stays
#    0 — this is the one path content, not $rc, must decide) ──────────────
PSQL_CALLS="$STUB_DIR/calls2"; export PSQL_CALLS; : > "$PSQL_CALLS"
PSQL_ENV_LOG="$STUB_DIR/env2"; export PSQL_ENV_LOG; : > "$PSQL_ENV_LOG"
output2="$(run 'PGTAP_INSTALLED=1' 2>&1)"; rc=$?
check_true "runs to completion (exit 0) with pgtap present" $rc
check "RESULT flips to 1 with pgtap installed and a real TAP failure" \
  "RESULT=1" "$(printf '%s\n' "$output2" | grep '^RESULT=')"
check "a pgTAP 'not ok' (rc stays 0, only content fails) is still caught as FAIL" \
  "sql: ccc_tapfail_test.sql|FAIL|see the block above this table" \
  "$(printf '%s\n' "$output2" | grep '^sql: ccc_tapfail_test.sql')"
# H5/M1 (round 5): THIS is the configuration the count floor must be
# checked against, not the pgtap-absent run below. With pgtap absent, ccc
# is SKIPped without ever calling psql, so a bug that silently truncated
# the file list to [aaa, bbb] would produce the exact SAME call count (1
# probe + 2 files = 3) as the correct behaviour — the floor would stay
# green while 1 of 3 files silently never ran. Here, with pgtap installed,
# ALL THREE files require their own psql call (1 probe + aaa + bbb + ccc =
# 4), so a truncation that drops even the LAST file changes the count.
check "H5/M1: exactly one psql call per file when every file requires one, plus the probe" \
  "4" "$(wc -l < "$PSQL_CALLS" | tr -d ' ')"

# ── M5 (round 3): a harmless NOTICE on the probe's STDERR must not change
#    the pgtap_ok decision. If it did, this run — pgtap genuinely
#    installed, decided from stdout only — would incorrectly SKIP
#    ccc_tapfail instead of running it and catching its real failure ──────
PSQL_CALLS="$STUB_DIR/calls_m5"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputM5="$(run 'PGTAP_INSTALLED=1 PSQL_PROBE_STDERR_NOISE=1' 2>&1)"; rc=$?
check_true "runs to completion (exit 0) with stderr noise on the probe" $rc
check "M5: a stderr NOTICE on the probe does not cause a false SKIP" \
  "sql: ccc_tapfail_test.sql|FAIL|see the block above this table" \
  "$(printf '%s\n' "$outputM5" | grep '^sql: ccc_tapfail_test.sql')"

# ── A SKIP for a missing prerequisite (pgtap not installed) must NEVER flip
#    RESULT on its own — only an actual test failure may. Isolated fixture
#    set with no failing file, so this cannot pass by accident because some
#    other file's FAIL happened to also flip RESULT ─────────────────────────
SKIP_ONLY_QA="$STUB_DIR/qa-skip-only"
mkdir -p "$SKIP_ONLY_QA/packages/database/supabase/tests"
cp "$FIXTURES/aaa_pass_test.sql" "$FIXTURES/ccc_tapfail_test.sql" \
  "$SKIP_ONLY_QA/packages/database/supabase/tests/"
PSQL_CALLS="$STUB_DIR/calls2b"; export PSQL_CALLS; : > "$PSQL_CALLS"
PSQL_ENV_LOG="$STUB_DIR/env2b"; export PSQL_ENV_LOG; : > "$PSQL_ENV_LOG"
output2b="$(run 'PGTAP_INSTALLED=' "$SKIP_ONLY_QA" 2>&1)"; rc=$?
check_true "runs to completion (exit 0) with only a pass and a pgtap-skip" $rc
check "RESULT stays 0 when the only non-ok row is a SKIPPED-NO-PGTAP" \
  "RESULT=0" "$(printf '%s\n' "$output2b" | grep '^RESULT=')"
check "the pgTAP file is still reported SKIP, not FAIL, for the missing prerequisite" \
  "sql: ccc_tapfail_test.sql|SKIP|pgtap extension not installed on QA" \
  "$(printf '%s\n' "$output2b" | grep '^sql: ccc_tapfail_test.sql')"

# ── H1/H3 (round 4): a file whose own output is large enough to fill and
#    overflow a pipe (~5000 lines here, real psql prints every prior result
#    set before the ERROR: line under ON_ERROR_STOP=1) must NOT kill
#    sql_tests_check via SIGPIPE in the old `head -20` — and the file AFTER
#    it (zzz_after) must still run, proving the loop survived. Separate QA
#    checkout: eee_bigfail (fails, large output) then zzz_after (passes) ──
BIG_QA="$STUB_DIR/qa-bigfail"
mkdir -p "$BIG_QA/packages/database/supabase/tests"
cp "$FIXTURES/eee_bigfail_test.sql" "$FIXTURES/zzz_after_test.sql" \
  "$BIG_QA/packages/database/supabase/tests/"
PSQL_CALLS="$STUB_DIR/calls_h1"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputH1="$(run 'PGTAP_INSTALLED=' "$BIG_QA" 2>&1)"; rc=$?
check_true "H1: a file with >64KiB of output does not SIGPIPE-kill the function" $rc
check "H1: RESULT flips to 1 from the big file's real failure" \
  "RESULT=1" "$(printf '%s\n' "$outputH1" | grep '^RESULT=')"
check "H1: the big file is reported FAIL, not silently dropped" \
  "true" "$(printf '%s\n' "$outputH1" | grep -q '^sql: eee_bigfail_test.sql|FAIL|' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "H1/H3: the file AFTER the big one still ran — the loop was not killed" \
  "sql: zzz_after_test.sql|ok|" \
  "$(printf '%s\n' "$outputH1" | grep '^sql: zzz_after_test.sql')"

# ── H4 (round 4): pgTAP's plan()/ran() COUNT mismatch is a separate
#    failure shape from an individual `not ok` — finish() emits a
#    "# Looks like you planned N but ran M" diagnostic with no "not ok"
#    anywhere, and psql still exits 0. The realistic trigger is editing a
#    file and forgetting to update plan(N) — must be FAIL, not ok ────────
PLANMIS_QA="$STUB_DIR/qa-planmismatch"
mkdir -p "$PLANMIS_QA/packages/database/supabase/tests"
cp "$FIXTURES/fff_planmismatch_test.sql" "$PLANMIS_QA/packages/database/supabase/tests/"
PSQL_CALLS="$STUB_DIR/calls_h4"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputH4="$(run 'PGTAP_INSTALLED=1' "$PLANMIS_QA" 2>&1)"; rc=$?
check_true "H4: runs to completion (exit 0) on a plan/ran mismatch" $rc
check "H4: a plan/ran mismatch with no 'not ok' anywhere is still reported FAIL" \
  "true" "$(printf '%s\n' "$outputH4" | grep -q '^sql: fff_planmismatch_test.sql|FAIL|' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "H4: RESULT flips to 1" \
  "RESULT=1" "$(printf '%s\n' "$outputH4" | grep '^RESULT=')"

# ── B2 (round 5): the WORST of the two round-5 findings. The content check
#    used to be `printf '%s' "$out" | grep -qE "$re"` — `grep -q` exits on
#    its FIRST match and closes its read end. With a `not ok 1` near the
#    START of $out and tens of thousands of `ok N` rows still queued behind
#    it (a large single pgTAP file, entirely realistic), `printf` is still
#    writing when grep quits: SIGPIPE, pipeline exits 141, 141 != 0 makes
#    the `elif` FALSE, falls to `else`, records "ok" — SILENTLY, no crash,
#    no FAIL row, nothing to notice. Strictly worse than H1 (which at
#    least killed the function loudly). Fixed by removing the pipe
#    entirely (`[[ $out =~ $re ]]`, no subprocess) ─────────────────────────
BIGTAP_QA="$STUB_DIR/qa-bigtap"
mkdir -p "$BIGTAP_QA/packages/database/supabase/tests"
cp "$FIXTURES/ggg_bigtap_test.sql" "$BIGTAP_QA/packages/database/supabase/tests/"
PSQL_CALLS="$STUB_DIR/calls_b2"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputB2="$(run 'PGTAP_INSTALLED=1' "$BIGTAP_QA" 2>&1)"; rc=$?
check_true "B2: runs to completion (exit 0) on a large pgTAP failure" $rc
check "B2: a 'not ok' near the start of a large output is still reported FAIL" \
  "true" "$(printf '%s\n' "$outputB2" | grep -q '^sql: ggg_bigtap_test.sql|FAIL|' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "B2: RESULT flips to 1 — not silently scored ok" \
  "RESULT=1" "$(printf '%s\n' "$outputB2" | grep '^RESULT=')"

# ── Total connection outage: EVERY per-file call fails as a connection
#    refusal. Under this design there is no marker/section to go missing —
#    each file's own $rc is simply nonzero, so every file is FAIL and none
#    can be silently scored ok ──────────────────────────────────────────────
PSQL_CALLS="$STUB_DIR/calls3b"; export PSQL_CALLS; : > "$PSQL_CALLS"
output3b="$(run 'PGTAP_INSTALLED= PSQL_CONN_FAIL=1' 2>&1)"; rc=$?
check_true "a connection failure does not propagate under set -e" $rc
check "RESULT flips to 1 when every file's own connection failed" \
  "RESULT=1" "$(printf '%s\n' "$output3b" | grep '^RESULT=')"
check "the clean file is reported FAIL, not ok, when its connection failed" \
  "true" "$(printf '%s\n' "$output3b" | grep -q '^sql: aaa_pass_test.sql|FAIL|' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "no file is silently scored ok on a connection failure" \
  "true" "$(printf '%s\n' "$output3b" | grep -q '|ok|' && echo false || echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)

# ── M6 (round 3): a file psql cannot even open (missing, permissions,
#    disappeared between glob and run) produces psql's OWN lowercase
#    "error:" — under round 2's design this matched neither the marker
#    guard nor the uppercase "ERROR:" content check and scored "ok". Under
#    this design it is simply $rc != 0 for that one file's own invocation —
#    nothing to parse, nothing to miss ──────────────────────────────────────
DDD_QA="$STUB_DIR/qa-notfound"
mkdir -p "$DDD_QA/packages/database/supabase/tests"
cp "$FIXTURES/aaa_pass_test.sql" "$FIXTURES/ddd_notfound_test.sql" \
  "$DDD_QA/packages/database/supabase/tests/"
PSQL_CALLS="$STUB_DIR/calls_m6"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputM6="$(run 'PGTAP_INSTALLED=' "$DDD_QA" 2>&1)"; rc=$?
check_true "runs to completion (exit 0) when one file cannot be opened" $rc
check "M6: an unopenable file is reported FAIL, not ok" \
  "true" "$(printf '%s\n' "$outputM6" | grep -q '^sql: ddd_notfound_test.sql|FAIL|' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "M6: RESULT flips to 1" \
  "RESULT=1" "$(printf '%s\n' "$outputM6" | grep '^RESULT=')"
check "M6: the unrelated file is still reported ok" \
  "sql: aaa_pass_test.sql|ok|" \
  "$(printf '%s\n' "$outputM6" | grep '^sql: aaa_pass_test.sql')"

# ── M2: the pgtap probe itself failing (couldn't even ask, vs. "asked and
#    got 0 rows") must FAIL the whole check, not silently route every
#    plan() file to SKIPPED-NO-PGTAP as if pgtap just wasn't installed ────
PSQL_CALLS="$STUB_DIR/calls_m2"; export PSQL_CALLS; : > "$PSQL_CALLS"
PSQL_ENV_LOG="$STUB_DIR/env_m2"; export PSQL_ENV_LOG; : > "$PSQL_ENV_LOG"
outputM2="$(run 'PSQL_PROBE_FAIL=1' 2>&1)"; rc=$?
check_true "runs to completion (exit 0) when the pgtap probe itself fails" $rc
check "RESULT flips to 1 when the pgtap probe could not run" \
  "RESULT=1" "$(printf '%s\n' "$outputM2" | grep '^RESULT=')"
check "records a blocking FAIL naming the probe failure" \
  "true" "$(printf '%s\n' "$outputM2" | grep -q '^sql tests|FAIL|could not determine whether pgtap is installed' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "no per-file row is recorded — the probe failure aborts before the loop" \
  "true" "$(printf '%s\n' "$outputM2" | grep -q '^sql: ' && echo false || echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)

# ── Missing POSTGRES_PASSWORD: skip cleanly, never invoke psql ─────────────
BAD_ENV="$STUB_DIR/.env.qa.blank"
printf 'POSTGRES_PASSWORD=\n' > "$BAD_ENV"
PSQL_CALLS="$STUB_DIR/calls4"; export PSQL_CALLS; : > "$PSQL_CALLS"
output4="$(QA_ENV_FILE="$BAD_ENV" bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; QA_ENV_FILE="'"$BAD_ENV"'"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "skips cleanly when POSTGRES_PASSWORD is missing" $rc
check "records a SKIP naming the missing password" \
  "sql tests|SKIP|POSTGRES_PASSWORD missing" \
  "$(printf '%s\n' "$output4" | grep '^sql tests')"
check "RESULT stays 0 — an env-absence SKIP is not a test failure" \
  "RESULT=0" "$(printf '%s\n' "$output4" | grep '^RESULT=')"
if [ ! -s "$PSQL_CALLS" ]; then
  pass=$((pass + 1)); echo "  ok   never calls psql when the password is missing"
else
  fail=$((fail + 1)); echo "  FAIL should not have called psql"
fi

# ── Missing tests directory: skip cleanly rather than error ────────────────
EMPTY_QA="$STUB_DIR/qa-empty"
mkdir -p "$EMPTY_QA"
output5="$(QA_CHECKOUT_DIR="$EMPTY_QA" bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; QA_CHECKOUT_DIR="'"$EMPTY_QA"'"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "skips cleanly when the tests dir is missing" $rc
check "records a SKIP naming the missing dir" \
  "true" "$(printf '%s\n' "$output5" | grep -q '^sql tests|SKIP|tests dir not found' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "RESULT stays 0 when the tests dir itself is missing" \
  "RESULT=0" "$(printf '%s\n' "$output5" | grep '^RESULT=')"

# ── Tests dir exists but has no *.sql files: skip cleanly, distinct reason ─
NO_SQL_QA="$STUB_DIR/qa-no-sql"
mkdir -p "$NO_SQL_QA/packages/database/supabase/tests"
output6="$(QA_CHECKOUT_DIR="$NO_SQL_QA" bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; QA_CHECKOUT_DIR="'"$NO_SQL_QA"'"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "skips cleanly when there are no *.sql files" $rc
check "records a SKIP naming the empty dir" \
  "true" "$(printf '%s\n' "$output6" | grep -q '^sql tests|SKIP|no \*\.sql files' && echo true)"  # pipefail-safe: bounded test-harness output (a handful of CHECKS rows / stub argv lines)
check "RESULT stays 0 when there are no *.sql files to run" \
  "RESULT=0" "$(printf '%s\n' "$output6" | grep '^RESULT=')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
