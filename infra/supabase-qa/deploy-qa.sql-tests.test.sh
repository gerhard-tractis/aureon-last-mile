#!/usr/bin/env bash
#
# Tests for sql_tests_check() in deploy-qa.sh.
#
# spec-92: sql_tests_check is now BLOCKING. packages/database/supabase/tests/
# (91 files, spec-93 fase 3) run against QA's live Postgres after every
# deploy, and a real SQL test failure (a RAISE EXCEPTION or a pgTAP
# `not ok`) now flips RESULT and fails the deploy, same as any other
# record()'d check. What stays advisory is ONLY the absence of something
# needed to run the tests at all, never a test result: missing
# POSTGRES_PASSWORD, a missing tests dir, no *.sql files in it, or a single
# file being skipped because pgtap isn't installed (SKIPPED-NO-PGTAP) — that
# last one is covered separately by ensure_pgtap()'s own CREATE-EXTENSION
# degraded-streak escalation (QA_PGTAP_DEGRADED_MAX), not duplicated here.
# These tests stub `psql` so the behaviour — especially "a failing SQL test
# DOES flip RESULT, but a SKIP for a missing prerequisite never does" — is
# verifiable without a VPS or a real database.
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

# A `psql` stub that fakes both invocations sql_tests_check makes:
#   1. `-tAc "SELECT 1 FROM pg_extension ..."`  -> prints PGTAP_INSTALLED, or
#      simulates the probe itself failing via PSQL_PROBE_FAIL (M2 — a query
#      that could not run at all, distinct from "ran, found 0 rows").
#   2. `-f <runner>`                            -> replays the generated
#      runner script line by line, faking what each \i'd test file would
#      have printed, keyed off the fixture's basename (never actually reads
#      or executes the .sql files — this is a control-flow test, not a SQL
#      test). Also logs every invocation and can be forced to fail via
#      PSQL_F_EXIT, to simulate a connection failure via PSQL_CONN_FAIL (psql
#      can't reach the server, prints lowercase "error:", NEVER processes the
#      runner, zero \echo markers, nonzero exit), to die partway through via
#      DIE_AFTER_LINE=<exact \echo'd line> (everything up to and including
#      that line prints, then psql exits — simulating a mid-run kill: later
#      files get no markers at all, and the file whose BEGIN was just
#      printed never gets its END), or to simulate B1's stdout/stderr
#      interleaving race via PSQL_INTERLEAVE_ERROR=1 — see the block below.
cat > "$STUB_DIR/psql" <<'STUB'
#!/usr/bin/env bash
echo "CALLED" >> "$PSQL_CALLS"
args=("$@")
runner=""
tac=0
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -f) runner="${args[$((i + 1))]}" ;;
    -tAc) tac=1 ;;
  esac
done

if [ "$tac" -eq 1 ]; then
  if [ "${PSQL_PROBE_FAIL:-}" = "1" ]; then
    echo "psql: error: connection to server at \"localhost\", port 5433 failed: Connection refused" >&2
    exit 2
  fi
  printf '%s' "${PGTAP_INSTALLED:-}"
  exit 0
fi

if [ -n "$runner" ]; then
  if [ "${PSQL_CONN_FAIL:-}" = "1" ]; then
    echo "psql: error: connection to server at \"localhost\", port 5433 failed: Connection refused" >&2
    exit 2
  fi

  if [ "${PSQL_INTERLEAVE_ERROR:-}" = "1" ]; then
    # B1: a real error goes to stderr, unbuffered, and can be FLUSHED BEFORE
    # the \echo BEGIN/END markers still sitting in psql's block-buffered
    # stdout pipe. Simulated here by printing the psql-style
    # "psql:<path>:<line>: ERROR:" line for the *error* fixture FIRST, at
    # the very top of the captured stream — nowhere near its own
    # BEGIN/END — and then suppressing that file's normal in-section
    # output entirely, matching what a real RAISE EXCEPTION leaves behind
    # positionally: nothing between its own markers.
    interleave_path="$(grep "^\\\\i '" "$runner" | grep error | sed "s/^\\\\i '//; s/'\$//")"
    if [ -n "$interleave_path" ]; then
      echo "psql:${interleave_path}:3: ERROR:  bbb assertion failed"
    fi
    while IFS= read -r line; do
      case "$line" in
        '\echo '*) echo "${line#\\echo }" ;;
        '\i '*)
          path="${line#\\i \'}"
          path="${path%\'}"
          if [ "$path" = "$interleave_path" ]; then
            : # its output already "left" earlier — section stays empty
          else
            base="$(basename "$path")"
            case "$base" in
              *tapfail*) echo "not ok 1 - fixture says fail" ;;
              *)         echo "(pretend passing output)" ;;
            esac
          fi
          ;;
      esac
    done < "$runner"
    exit "${PSQL_F_EXIT:-0}"
  fi

  while IFS= read -r line; do
    case "$line" in
      '\echo '*)
        content="${line#\\echo }"
        echo "$content"
        if [ -n "${DIE_AFTER_LINE:-}" ] && [ "$content" = "$DIE_AFTER_LINE" ]; then
          exit 5
        fi
        ;;
      '\i '*)
        path="${line#\\i \'}"
        path="${path%\'}"
        base="$(basename "$path")"
        case "$base" in
          *error*)   echo "ERROR:  boom" ;;
          *tapfail*) echo "not ok 1 - fixture says fail" ;;
          *)         echo "(pretend passing output)" ;;
        esac
        ;;
    esac
  done < "$runner"
  exit "${PSQL_F_EXIT:-0}"
fi
exit 0
STUB
chmod +x "$STUB_DIR/psql"
export PATH="$STUB_DIR:$PATH"

# Fixture test files. Content matters only for the `plan(` sniff that decides
# pgTAP-vs-DO-block routing; the stub decides pass/fail/skip by filename.
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

export QA_CHECKOUT_DIR="$STUB_DIR/qa"
export QA_ENV_FILE="$STUB_DIR/.env.qa"
mkdir -p "$QA_CHECKOUT_DIR/packages/database/supabase/tests"
cp "$FIXTURES"/*.sql "$QA_CHECKOUT_DIR/packages/database/supabase/tests/"
printf 'POSTGRES_PASSWORD=s3cret\n' > "$QA_ENV_FILE"

# Source only the pieces under test, so sourcing cannot trigger the script's
# own setup. Mirrors deploy-qa.seed.test.sh / deploy-qa.guard-sudo.test.sh.
extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
build_harness() {
  {
    echo "set -uo pipefail"
    echo "QA_CHECKOUT_DIR=\"$QA_CHECKOUT_DIR\""
    echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
    echo "QA_SQL_STATEMENT_TIMEOUT_MS=\"\${QA_SQL_STATEMENT_TIMEOUT_MS:-30000}\""
    echo "QA_SQL_CONNECT_TIMEOUT_SEC=\"\${QA_SQL_CONNECT_TIMEOUT_SEC:-10}\""
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

# ── Normal run, pgtap NOT installed on QA ───────────────────────────────────
PSQL_CALLS="$STUB_DIR/calls1"; export PSQL_CALLS; : > "$PSQL_CALLS"
PGTAP_INSTALLED="" \
  bash -c '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' \
  > "$STUB_DIR/out1" 2>&1
rc=$?
check_true "runs to completion (exit 0) with pgtap absent" $rc

check "RESULT flips to 1 because the RAISE EXCEPTION file really failed" \
  "RESULT=1" "$(grep '^RESULT=' "$STUB_DIR/out1")"
check "the RAISE EXCEPTION file is reported FAIL" \
  "sql: bbb_error_test.sql|FAIL|see the block above this table" \
  "$(grep '^sql: bbb_error_test.sql' "$STUB_DIR/out1")"
check "the clean file is reported ok" \
  "sql: aaa_pass_test.sql|ok|" \
  "$(grep '^sql: aaa_pass_test.sql' "$STUB_DIR/out1")"
check "the pgTAP file is SKIPped, not run, when pgtap is not installed" \
  "sql: ccc_tapfail_test.sql|SKIP|pgtap extension not installed on QA" \
  "$(grep '^sql: ccc_tapfail_test.sql' "$STUB_DIR/out1")"

# ── pgtap IS installed on QA: the same pgTAP file now actually "runs" and
#    its `not ok` line must be caught even though nothing raised, and now
#    that failure must flip RESULT too ──────────────────────────────────────
PSQL_CALLS="$STUB_DIR/calls2"; export PSQL_CALLS; : > "$PSQL_CALLS"
PGTAP_INSTALLED="1" \
  bash -c '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' \
  > "$STUB_DIR/out2" 2>&1
rc=$?
check_true "runs to completion (exit 0) with pgtap present" $rc
check "RESULT flips to 1 with pgtap installed and a real TAP failure" \
  "RESULT=1" "$(grep '^RESULT=' "$STUB_DIR/out2")"
check "a pgTAP 'not ok' (no ERROR text at all) is still caught as FAIL" \
  "sql: ccc_tapfail_test.sql|FAIL|see the block above this table" \
  "$(grep '^sql: ccc_tapfail_test.sql' "$STUB_DIR/out2")"

# ── A SKIP for a missing prerequisite (pgtap not installed) must NEVER flip
#    RESULT on its own — only an actual test failure may. Isolated fixture
#    set with no failing file, so this cannot pass by accident because some
#    other file's FAIL happened to also flip RESULT ─────────────────────────
SKIP_ONLY_QA="$STUB_DIR/qa-skip-only"
mkdir -p "$SKIP_ONLY_QA/packages/database/supabase/tests"
cp "$FIXTURES/aaa_pass_test.sql" "$FIXTURES/ccc_tapfail_test.sql" \
  "$SKIP_ONLY_QA/packages/database/supabase/tests/"
PSQL_CALLS="$STUB_DIR/calls2b"; export PSQL_CALLS; : > "$PSQL_CALLS"
output2b="$(QA_CHECKOUT_DIR="$SKIP_ONLY_QA" PGTAP_INSTALLED="" bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; QA_CHECKOUT_DIR="'"$SKIP_ONLY_QA"'"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "runs to completion (exit 0) with only a pass and a pgtap-skip" $rc
check "RESULT stays 0 when the only non-ok row is a SKIPPED-NO-PGTAP" \
  "RESULT=0" "$(printf '%s\n' "$output2b" | grep '^RESULT=')"
check "the pgTAP file is still reported SKIP, not FAIL, for the missing prerequisite" \
  "sql: ccc_tapfail_test.sql|SKIP|pgtap extension not installed on QA" \
  "$(printf '%s\n' "$output2b" | grep '^sql: ccc_tapfail_test.sql')"

# ── psql itself exits non-zero (e.g. one bad statement under
#    ON_ERROR_STOP=0) — must not blow up the caller under set -e. The stub's
#    captured output is unaffected by PSQL_F_EXIT (matching real psql, whose
#    stdout/stderr text is what sql_tests_check greps, not its exit status —
#    see the function's own "Failure detection" comment), so this run still
#    contains bbb_error_test.sql's real ERROR: and RESULT flips to 1 for
#    that reason, same as test 1 — a nonzero psql exit is not itself what
#    fails the deploy, a real test failure in the captured output is ───────
PSQL_CALLS="$STUB_DIR/calls3"; export PSQL_CALLS; : > "$PSQL_CALLS"
output3="$(set -e; PGTAP_INSTALLED="" PSQL_F_EXIT=2 bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "a nonzero psql exit does not propagate under set -e" $rc
check "RESULT flips to 1 from the real ERROR in the captured output" \
  "RESULT=1" "$(printf '%s\n' "$output3" | grep '^RESULT=')"

# ── psql cannot even connect (real 2026-09-10 review finding): it never
#    processes the runner at all, so $output has ZERO \echo BEGIN/END
#    markers and no "ERROR:"/"not ok" text either (real psql prints
#    lowercase "error: connection ... failed", which the FAIL grep does not
#    match). Before this fix every per-file section came back empty and
#    fell through to the "ok" branch — a fully green table from a run that
#    executed NOTHING. Must now score every file FAIL, and RESULT must flip
#    to 1, not stay 0 (this is not a SKIP: the prerequisites — password,
#    tests dir, files — were all present; the run itself broke) ───────────
PSQL_CALLS="$STUB_DIR/calls3b"; export PSQL_CALLS; : > "$PSQL_CALLS"
output3b="$(set -e; PGTAP_INSTALLED="" PSQL_CONN_FAIL=1 bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "a connection failure does not propagate under set -e" $rc
check "RESULT flips to 1 when psql never ran a single file" \
  "RESULT=1" "$(printf '%s\n' "$output3b" | grep '^RESULT=')"
check "the clean file is reported FAIL, not ok, when it never actually ran" \
  "sql: aaa_pass_test.sql|FAIL|psql did not run this file — see deploy log" \
  "$(printf '%s\n' "$output3b" | grep '^sql: aaa_pass_test.sql')"
check "the pgTAP file is reported FAIL, not SKIP, when it never actually ran" \
  "sql: ccc_tapfail_test.sql|FAIL|psql did not run this file — see deploy log" \
  "$(printf '%s\n' "$output3b" | grep '^sql: ccc_tapfail_test.sql')"
check "no file is silently scored ok on a connection failure" \
  "true" "$(printf '%s\n' "$output3b" | grep -q '|ok|' && echo false || echo true)"

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

# ── B1 (spec-92 review round 2): a real ERROR: for one file can be flushed
#    to the merged stdout+stderr stream BEFORE that file's own BEGIN/END
#    markers, when psql's stdout is block-buffered on a pipe and stderr is
#    not. All markers are still present (the marker-pair guard tested above
#    does not catch this), but the file's own section comes back EMPTY —
#    reproduced against the real function before this fix, scoring the
#    failed file "ok". Attribution must not depend on position ───────────
PSQL_CALLS="$STUB_DIR/calls_b1"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputB1="$(PGTAP_INSTALLED="" PSQL_INTERLEAVE_ERROR=1 bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "runs to completion (exit 0) under an interleaved ERROR" $rc
check "RESULT flips to 1 even though the ERROR line landed outside every section" \
  "RESULT=1" "$(printf '%s\n' "$outputB1" | grep '^RESULT=')"
check "the interleaved-error file is reported FAIL, not ok" \
  "sql: bbb_error_test.sql|FAIL|see the block above this table" \
  "$(printf '%s\n' "$outputB1" | grep '^sql: bbb_error_test.sql')"
check "the unrelated clean file is unaffected" \
  "sql: aaa_pass_test.sql|ok|" \
  "$(printf '%s\n' "$outputB1" | grep '^sql: aaa_pass_test.sql')"

# ── M1: the END half of the marker guard, exercised on its own. One file
#    gets BEGIN with no END (psql killed mid-file); a later file gets
#    NEITHER marker (never reached). A stub that only ever produces
#    all-or-nothing output (like PSQL_CONN_FAIL) cannot tell these two
#    `||` branches apart — this fixture can ────────────────────────────────
PSQL_CALLS="$STUB_DIR/calls_m1"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputM1="$(PGTAP_INSTALLED="" DIE_AFTER_LINE="__SQLTEST_BEGIN__ bbb_error_test.sql" bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "runs to completion (exit 0) on a mid-run death" $rc
check "RESULT flips to 1 on a mid-run death" \
  "RESULT=1" "$(printf '%s\n' "$outputM1" | grep '^RESULT=')"
check "the file before the death is unaffected" \
  "sql: aaa_pass_test.sql|ok|" \
  "$(printf '%s\n' "$outputM1" | grep '^sql: aaa_pass_test.sql')"
check "the file with BEGIN but no END is reported FAIL, not ok" \
  "sql: bbb_error_test.sql|FAIL|psql did not run this file — see deploy log" \
  "$(printf '%s\n' "$outputM1" | grep '^sql: bbb_error_test.sql')"
check "the file reached after the death (no markers at all) is also FAIL" \
  "sql: ccc_tapfail_test.sql|FAIL|psql did not run this file — see deploy log" \
  "$(printf '%s\n' "$outputM1" | grep '^sql: ccc_tapfail_test.sql')"

# ── M2: the pgtap probe itself failing (couldn't even ask, vs. "asked and
#    got 0 rows") must FAIL the whole check, not silently route every
#    plan() file to SKIPPED-NO-PGTAP as if pgtap just wasn't installed ────
PSQL_CALLS="$STUB_DIR/calls_m2"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputM2="$(PSQL_PROBE_FAIL=1 bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "runs to completion (exit 0) when the pgtap probe itself fails" $rc
check "RESULT flips to 1 when the pgtap probe could not run" \
  "RESULT=1" "$(printf '%s\n' "$outputM2" | grep '^RESULT=')"
check "records a blocking FAIL naming the probe failure" \
  "true" "$(printf '%s\n' "$outputM2" | grep -q '^sql tests|FAIL|could not determine whether pgtap is installed' && echo true)"
check "no per-file row is recorded — the probe failure aborts before the runner" \
  "true" "$(printf '%s\n' "$outputM2" | grep -q '^sql: ' && echo false || echo true)"

# ── M3: a nonzero psql exit ALONE — no ERROR:/not ok anywhere in the
#    output, no missing markers — must NOT flip RESULT. Distinguishes "the
#    exit code decided" from "real content in the output decided": this
#    fixture set has no failing file, so if something wrongly keyed off
#    $rc instead of $output/$section, this is the assertion that catches it ─
PSQL_CALLS="$STUB_DIR/calls_m3"; export PSQL_CALLS; : > "$PSQL_CALLS"
outputM3="$(QA_CHECKOUT_DIR="$SKIP_ONLY_QA" PGTAP_INSTALLED="" PSQL_F_EXIT=2 bash -c \
  '. "'"$STUB_DIR"'/harness.sh"; QA_CHECKOUT_DIR="'"$SKIP_ONLY_QA"'"; sql_tests_check; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "runs to completion (exit 0) when psql exits nonzero with no real failures" $rc
check "RESULT stays 0 — a nonzero psql exit alone is not a test failure" \
  "RESULT=0" "$(printf '%s\n' "$outputM3" | grep '^RESULT=')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
