#!/usr/bin/env bash
#
# Tests for ensure_pgtap() in deploy-qa.sh (spec-93 fase 3).
#
# Measured on QA 2026-09-10: `SELECT count(*) FROM pg_extension WHERE
# extname='pgtap'` returned 0, even though pg_available_extensions lists
# version 1.3.3 as installable. sql_tests_check() already knows how to skip a
# pgTAP file when the extension is absent (SKIPPED-NO-PGTAP) — but nothing
# ever created it, so all 20 files using plan()/finish() have been silently
# skipped since they were written. ensure_pgtap() closes that: idempotent
# (`CREATE EXTENSION IF NOT EXISTS`), run on every deploy so it also survives
# a QA "DB reset" (data dir wiped, migrations replayed — see
# docs/qa-environment.md) the same way apply_migrations/apply_seed already
# re-provision state on every run.
#
# Run: bash infra/supabase-qa/deploy-qa.pgtap.test.sh
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

check_true() { # $1 name, $2 exit code
  if [ "$2" -eq 0 ]; then
    pass=$((pass + 1)); echo "  ok   $1"
  else
    fail=$((fail + 1)); echo "  FAIL $1"
  fi
}

# A `psql` stub logging every invocation's argv and failing on demand.
cat > "$STUB_DIR/psql" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PSQL_CALLS"
if [ -n "${PSQL_FAIL:-}" ]; then
  echo "psql: error: connection refused" >&2
  exit 2
fi
exit 0
STUB
chmod +x "$STUB_DIR/psql"
export PATH="$STUB_DIR:$PATH"

export QA_ENV_FILE="$STUB_DIR/.env.qa"
printf 'POSTGRES_PASSWORD=s3cret\n' > "$QA_ENV_FILE"

export QA_PGTAP_DEGRADED_FILE="$STUB_DIR/pgtap-degraded"
export QA_PGTAP_DEGRADED_MAX=3

extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
build_harness() {
  {
    # B3 (spec-92 review round 3): the real script runs under
    # `set -Eeuo pipefail` (deploy-qa.sh:57). This harness used to run the
    # extracted function under only `set -uo pipefail` — missing -e AND -E —
    # so an `exit`-on-error-mid-pipeline bug in the real function (the exact
    # shape B2 took) could never be observed here: `-e` is what makes a
    # failing command actually abort, and without it every assertion below
    # only ever sees "did the harness process return 0", which it always
    # does when -e isn't set. Matching the script's real flags is what makes
    # this suite able to catch that class of bug at all.
    echo "set -Eeuo pipefail"
    echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
    echo "QA_PGTAP_DEGRADED_FILE=\"$QA_PGTAP_DEGRADED_FILE\""
    echo "QA_PGTAP_DEGRADED_MAX=\"$QA_PGTAP_DEGRADED_MAX\""
    echo "QA_EXIT_PGTAP_STREAK=79"
    echo "QA_SQL_STATEMENT_TIMEOUT_MS=\"\${QA_SQL_STATEMENT_TIMEOUT_MS:-30000}\""
    echo "QA_SQL_CONNECT_TIMEOUT_SEC=\"\${QA_SQL_CONNECT_TIMEOUT_SEC:-10}\""
    echo "CHECKS=()"
    echo "RESULT=0"
    extract log
    extract err
    extract env_get
    extract record_advisory
    extract write_atomic
    extract ensure_pgtap
  } > "$STUB_DIR/harness.sh"
}
build_harness

echo "ensure_pgtap()"

# ── Happy path: creates the extension, records ok, never touches RESULT ────
PSQL_CALLS="$STUB_DIR/calls1"; export PSQL_CALLS; : > "$PSQL_CALLS"
output1="$(bash -c '. "'"$STUB_DIR"'/harness.sh"; ensure_pgtap; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "runs to completion" $rc
check "issues CREATE EXTENSION IF NOT EXISTS pgtap" \
  "true" "$(grep -qi 'CREATE EXTENSION IF NOT EXISTS pgtap' "$PSQL_CALLS" && echo true)"
# m1 (review round) — the connection TARGET wasn't asserted at all: mutating
# `-p 5433` to `-p 5432`, or `-d postgres` to `-d template1`, left this
# suite green. QA's real Postgres only ever listens on localhost:5433/db
# postgres — the same invocation apply_migrations/db_check/sql_tests_check
# already use.
check "targets QA's own Postgres (localhost:5433/postgres), not some other port/db" \
  "true" "$(grep -qE -- '-h localhost -p 5433 -U postgres -d postgres' "$PSQL_CALLS" && echo true)"
check "records ok" \
  "pgtap extension|ok|installed" \
  "$(printf '%s\n' "$output1" | grep '^pgtap extension')"
check "RESULT stays 0" \
  "RESULT=0" "$(printf '%s\n' "$output1" | grep '^RESULT=')"

# ── psql fails outright — advisory ON THE FIRST FAILURE, must not flip
#    RESULT or propagate ───────────────────────────────────────────────────
rm -f "$QA_PGTAP_DEGRADED_FILE"
PSQL_CALLS="$STUB_DIR/calls2"; export PSQL_CALLS; : > "$PSQL_CALLS"
output2="$(set -e; PSQL_FAIL=1 bash -c '. "'"$STUB_DIR"'/harness.sh"; ensure_pgtap; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "a single hard psql failure does not propagate under set -e" $rc
check "records FAIL rather than pretending success" \
  "true" "$(printf '%s\n' "$output2" | grep -q '^pgtap extension|FAIL|' && echo true)"
check "RESULT still stays 0 on the first failure (advisory, same as sql_tests_check)" \
  "RESULT=0" "$(printf '%s\n' "$output2" | grep '^RESULT=')"
check "records the failure streak so it can escalate" \
  "1" "$(cat "$QA_PGTAP_DEGRADED_FILE" 2>/dev/null)"

# ── A success after a failure resets the streak — same reset behaviour as
#    record_deploy_marker()'s QA_DEGRADED_FILE ──────────────────────────────
PSQL_CALLS="$STUB_DIR/calls2b"; export PSQL_CALLS; : > "$PSQL_CALLS"
bash -c '. "'"$STUB_DIR"'/harness.sh"; ensure_pgtap' >/dev/null 2>&1
check "a subsequent success clears the streak file" \
  "false" "$([ -f "$QA_PGTAP_DEGRADED_FILE" ] && echo true || echo false)"

# ── review round — the whole point of B4: CREATE EXTENSION failing
#    REPEATEDLY (e.g. the role genuinely lacks the privilege) must eventually
#    fail the deploy instead of degrading to a silent FAIL row forever, same
#    escalation shape as record_deploy_marker()'s QA_DEGRADED_MAX ──────────
rm -f "$QA_PGTAP_DEGRADED_FILE"
PSQL_CALLS="$STUB_DIR/calls_streak"; export PSQL_CALLS; : > "$PSQL_CALLS"
run=1
while [ "$run" -le "$QA_PGTAP_DEGRADED_MAX" ]; do
  PSQL_FAIL=1 bash -c '. "'"$STUB_DIR"'/harness.sh"; ensure_pgtap' >"$STUB_DIR/streak_out_$run" 2>&1
  streak_rc[$run]=$?
  run=$((run + 1))
done
check "runs before the streak limit stay green (exit 0)" \
  "0" "${streak_rc[$((QA_PGTAP_DEGRADED_MAX - 1))]}"
check "the run that reaches QA_PGTAP_DEGRADED_MAX fails the deploy on purpose" \
  "79" "${streak_rc[$QA_PGTAP_DEGRADED_MAX]}"
check "the escalating run names a DISTINCT exit code from the marker's 78" \
  "true" "$(grep -q 'QA_EXIT_PGTAP_STREAK\|pgtap extension.*times in a row\|failed to create the pgtap extension' "$STUB_DIR/streak_out_$QA_PGTAP_DEGRADED_MAX" && echo true)"

# ── Missing POSTGRES_PASSWORD: skip cleanly, never invoke psql ─────────────
BAD_ENV="$STUB_DIR/.env.qa.blank"
printf 'POSTGRES_PASSWORD=\n' > "$BAD_ENV"
PSQL_CALLS="$STUB_DIR/calls3"; export PSQL_CALLS; : > "$PSQL_CALLS"
output3="$(bash -c '. "'"$STUB_DIR"'/harness.sh"; QA_ENV_FILE="'"$BAD_ENV"'"; ensure_pgtap; printf "%s\n" "${CHECKS[@]}"' 2>&1)"
rc=$?
check_true "skips cleanly when POSTGRES_PASSWORD is missing" $rc
check "records a SKIP naming the missing password" \
  "pgtap extension|SKIP|POSTGRES_PASSWORD missing" \
  "$(printf '%s\n' "$output3" | grep '^pgtap extension')"
if [ ! -s "$PSQL_CALLS" ]; then
  pass=$((pass + 1)); echo "  ok   never calls psql when the password is missing"
else
  fail=$((fail + 1)); echo "  FAIL should not have called psql"
fi

echo ""
echo "post_checks() ordering"

# ensure_pgtap must run BEFORE sql_tests_check — otherwise the very deploy
# that installs pgtap still reports the 20 pgTAP files SKIPPED-NO-PGTAP,
# because sql_tests_check's own `pg_extension` check would have already run.
#
# m2 (review round) — this is a TEXTUAL check on the call-site order inside
# post_checks()'s source, not an execution-order check (it never actually
# runs post_checks()). It reliably catches the realistic mutations —
# reordering the two calls, or deleting the ensure_pgtap call entirely (both
# verified above by mutation-testing the implementation) — but it does NOT
# catch, say, an extra unrelated `sql_tests_check` call inserted earlier in
# the function while both real calls stay in the right relative order; that
# residual gap was measured and accepted as non-blocking. Matched as
# whole-line calls (`^  ensure_pgtap$`), not a substring grep — the comment
# right above the real call also mentions "sql_tests_check" by name, which a
# substring match would see first and report a false pass.
check "post_checks calls ensure_pgtap before sql_tests_check" \
  "ensure_pgtap
sql_tests_check" \
  "$(awk '/^post_checks\(\)/,/^}/' "$HERE/deploy-qa.sh" \
    | grep -E '^  (ensure_pgtap|sql_tests_check)$' \
    | sed 's/^  //')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
