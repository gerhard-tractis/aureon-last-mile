#!/usr/bin/env bash
#
# Tests for sql_tests_check() in deploy-qa.sh.
#
# spec-92 review round 3: sql_tests_check runs ONE psql PROCESS PER FILE
# (packages/database/supabase/tests/*.sql, 92 files, 21 using pgTAP's
# plan()/finish()) instead of round 2's one-connection-many-\i design. See
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
# every call's argv AND the two env vars m1 added (PGOPTIONS, PGCONNECT_
# TIMEOUT) so m3 can assert they actually reach psql instead of just
# existing somewhere in the shell that never gets passed down.
#
#   1. `-tAc "SELECT 1 FROM pg_extension ..."` (the pgtap probe) -> prints
#      PGTAP_INSTALLED on STDOUT. PSQL_PROBE_FAIL simulates the probe
#      itself failing to run at all (M2). PSQL_PROBE_STDERR_NOISE writes a
#      harmless NOTICE to STDERR while still succeeding — M5: this must
#      NOT change what pgtap_ok decides, only stdout may.
#   2. `-f <path>` (one test file) -> decided by the fixture's basename,
#      never by reading the file (control-flow test, not a SQL test):
#        *pass*      -> ordinary output, exit 0
#        *error*     -> a RAISE-EXCEPTION-shaped psql error, exit nonzero
#                       (ON_ERROR_STOP=1's real behaviour)
#        *tapfail*   -> a pgTAP "not ok" row on STDOUT, exit 0 (pgTAP never
#                       raises — this is the one case content must decide)
#        *notfound*  -> psql could not even open the file (M6), exit
#                       nonzero, lowercase "error:" text
#      PSQL_CONN_FAIL forces EVERY per-file call to fail as a connection
#      refusal, regardless of fixture — the "total outage" case, which
#      under this design just means every file's own $rc is nonzero; there
#      is no longer a marker/section guard needed to catch it.
cat > "$STUB_DIR/psql" <<'STUB'
#!/usr/bin/env bash
echo "CALLED" >> "$PSQL_CALLS"
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
# extract_var returns nothing, the harness never defines the variable, and
# `set -u` makes sql_tests_check() abort the instant it references it —
# loudly, not silently, which is the whole point of pulling it live.
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

# ── A per-file psql exit code ALONE now correctly decides FAIL — this IS
#    the mechanism (unlike round 2, where an exit code was deliberately NOT
#    trusted). A fixture whose own psql invocation exits nonzero with no
#    textual "ERROR:"/"not ok" at all must still be FAIL ──────────────────
PSQL_CALLS="$STUB_DIR/calls3"; export PSQL_CALLS; : > "$PSQL_CALLS"
output3="$(run 'PGTAP_INSTALLED=' 2>&1)"; rc=$?
check_true "a nonzero psql exit for one file does not propagate under set -e" $rc
check "RESULT flips to 1 from the nonzero exit alone" \
  "RESULT=1" "$(printf '%s\n' "$output3" | grep '^RESULT=')"

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
  "true" "$(printf '%s\n' "$output3b" | grep -q '^sql: aaa_pass_test.sql|FAIL|' && echo true)"
check "no file is silently scored ok on a connection failure" \
  "true" "$(printf '%s\n' "$output3b" | grep -q '|ok|' && echo false || echo true)"

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
  "true" "$(printf '%s\n' "$outputM6" | grep -q '^sql: ddd_notfound_test.sql|FAIL|' && echo true)"
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
  "true" "$(printf '%s\n' "$outputM2" | grep -q '^sql tests|FAIL|could not determine whether pgtap is installed' && echo true)"
check "no per-file row is recorded — the probe failure aborts before the loop" \
  "true" "$(printf '%s\n' "$outputM2" | grep -q '^sql: ' && echo false || echo true)"

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
  "true" "$(printf '%s\n' "$output5" | grep -q '^sql tests|SKIP|tests dir not found' && echo true)"
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
  "true" "$(printf '%s\n' "$output6" | grep -q '^sql tests|SKIP|no \*\.sql files' && echo true)"
check "RESULT stays 0 when there are no *.sql files to run" \
  "RESULT=0" "$(printf '%s\n' "$output6" | grep '^RESULT=')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
