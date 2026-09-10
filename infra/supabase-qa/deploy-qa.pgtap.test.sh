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

extract() { sed -n "/^$1() {/,/^}/p" "$HERE/deploy-qa.sh"; }
build_harness() {
  {
    echo "set -uo pipefail"
    echo "QA_ENV_FILE=\"$QA_ENV_FILE\""
    echo "CHECKS=()"
    echo "RESULT=0"
    extract log
    extract err
    extract env_get
    extract record_advisory
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
check "records ok" \
  "pgtap extension|ok|installed" \
  "$(printf '%s\n' "$output1" | grep '^pgtap extension')"
check "RESULT stays 0" \
  "RESULT=0" "$(printf '%s\n' "$output1" | grep '^RESULT=')"

# ── psql fails outright — advisory, must not flip RESULT or propagate ──────
PSQL_CALLS="$STUB_DIR/calls2"; export PSQL_CALLS; : > "$PSQL_CALLS"
output2="$(set -e; PSQL_FAIL=1 bash -c '. "'"$STUB_DIR"'/harness.sh"; ensure_pgtap; printf "%s\n" "${CHECKS[@]}"; echo "RESULT=$RESULT"' 2>&1)"
rc=$?
check_true "a hard psql failure does not propagate under set -e" $rc
check "records FAIL rather than pretending success" \
  "true" "$(printf '%s\n' "$output2" | grep -q '^pgtap extension|FAIL|' && echo true)"
check "RESULT still stays 0 (advisory, same as sql_tests_check)" \
  "RESULT=0" "$(printf '%s\n' "$output2" | grep '^RESULT=')"

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
# Matched as whole-line calls (`^  ensure_pgtap$`), not a substring grep —
# the comment right above the call also mentions "sql_tests_check" by name,
# which a substring match would see first and report a false pass.
check "post_checks calls ensure_pgtap before sql_tests_check" \
  "ensure_pgtap
sql_tests_check" \
  "$(awk '/^post_checks\(\)/,/^}/' "$HERE/deploy-qa.sh" \
    | grep -E '^  (ensure_pgtap|sql_tests_check)$' \
    | sed 's/^  //')"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
