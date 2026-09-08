#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-87 fase 1) — the quarantine veto
# STEP inside e2e-qa (not the job-level needs:/if: checks, which live in
# check-deploy-gating.test.sh). Split out to stay under the repo's 300-line
# guideline; the round-4 re-review vectors (B1/B2/B3, ordering) live in
# check-deploy-gating-quarantine-r4.test.sh, which shares this file's
# fixture factory by duplicating it (same pattern as check-quarantine's own
# split test files).
# Run: bash scripts/check-deploy-gating-quarantine.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/check-deploy-gating.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# assert_exit <expected_code> <test name> <workflow yaml>
assert_exit() {
  local expected="$1" name="$2" yaml="$3" actual output
  printf '%s\n' "$yaml" > "$TMP/wf.yml"
  output=$(bash "$SCRIPT" "$TMP/wf.yml" 2>&1)
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

# assert_contains <needle> <test name> <workflow yaml>
assert_contains() {
  local needle="$1" name="$2" yaml="$3" output
  printf '%s\n' "$yaml" > "$TMP/wf.yml"
  output=$(bash "$SCRIPT" "$TMP/wf.yml" 2>&1 || true)
  if printf '%s' "$output" | grep -qF "$needle"; then
    pass=$((pass + 1))
    echo "  ok   $name"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — output did not contain: $needle"
    printf '%s\n' "$output" | sed 's/^/         /'
  fi
}

echo "check-deploy-gating.sh — quarantine veto step"

# ── e2e-qa must keep a step that enforces the quarantine list (spec-87) ──────
# check-deploy-gating.mjs asserts needs:/continue-on-error/if: at JOB
# granularity. The quarantine veto (spec-87 fase 1) lives inside a STEP —
# "Run E2E against QA" no longer fails the job on a raw red exit code
# (`|| true`), and "Check quarantine" is what decides pass/fail instead.
# Deleting that step, giving it its own continue-on-error, gating it behind
# an if: other than the provisioning check, adding `|| true`/`|| :` to its
# run:, or wrapping the invocation in `echo` all leave e2e-qa green no
# matter what failed. review round 2, H1 — the guard only caught the first
# two of these five vectors; the fixture factory below drives all five off
# one skeleton so adding a sixth is a one-line diff, not forty.
#
# wf_with_e2e_step <step-yaml-indented-6-spaces> [job-level-lines-indented-4-spaces] -> full workflow on stdout
wf_with_e2e_step() {
  local step="$1" job_extra="${2:-}"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n    needs: [changes, deploy-qa]\n'
  if [ -n "$job_extra" ]; then
    printf '%s\n' "$job_extra"
  fi
  printf '    steps:\n'
  printf '      - name: Run E2E against QA\n        run: npm run e2e:qa || true\n'
  printf '%s\n' "$step"
  printf '  approve-production:\n    needs: [changes, deploy-qa, e2e-qa]\n    environment: production\n'
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
}

BASELINE_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
assert_exit 0 "accepts e2e-qa with a check-quarantine.sh step" "$(wf_with_e2e_step "$BASELINE_STEP")"

NO_STEP='      - name: Upload report
        run: echo done'
WF=$(wf_with_e2e_step "$NO_STEP")
assert_exit 1 "fails when e2e-qa has no check-quarantine.sh step" "$WF"
assert_contains "check-quarantine.sh" "names the missing quarantine step" "$WF"

CONTINUE_ON_ERROR_STEP='      - name: Check quarantine
        continue-on-error: true
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$CONTINUE_ON_ERROR_STEP")
assert_exit 1 "fails when the quarantine step itself has continue-on-error" "$WF"
assert_contains "Check quarantine" "names the offending step" "$WF"

# H1 vector: `|| true` appended to the run: — the step still "runs" and still
# "succeeds", having checked nothing.
OR_TRUE_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json || true'
WF=$(wf_with_e2e_step "$OR_TRUE_STEP")
assert_exit 1 "fails when the quarantine step's run has || true appended" "$WF"

# H1 vector: `|| :` — the POSIX no-op, same effect as || true. Block scalar
# (run: |) because a trailing bare `:` breaks YAML's plain-scalar parsing.
OR_COLON_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json || :'
WF=$(wf_with_e2e_step "$OR_COLON_STEP")
assert_exit 1 "fails when the quarantine step's run has || : appended" "$WF"

# H1 vector: if: false — the step never runs, and no report is ever checked.
IF_FALSE_STEP='      - name: Check quarantine
        if: false
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$IF_FALSE_STEP")
assert_exit 1 "fails when the quarantine step's if: is not the provisioning check" "$WF"

# H1 vector: if: some other condition entirely — same effect as if: false in
# every run where that condition is not met, but reads like a legitimate guard.
IF_WRONG_STEP='      - name: Check quarantine
        if: github.event_name == '"'"'never'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$IF_WRONG_STEP")
assert_exit 1 "fails when the quarantine step's if: is an unrelated condition" "$WF"

# H1 vector: the invocation itself is echoed instead of run.
ECHO_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: echo bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$ECHO_STEP")
assert_exit 1 "fails when the quarantine step's run only echoes the invocation" "$WF"

# ── B1 (re-review round 3): the denylist above is a losing strategy ──────────
# A code-review sweep built eight vectors off the SAME factory and got exit 0
# from all of them — `neutralisesQuarantineCheck` only recognises the shapes it
# was told about. V7 is introduced BY this very branch: `--validate-only` is a
# real, documented flag of check-quarantine.mjs that exits 0 having read no
# report at all. The fix asserts the one accepted shape (a positive assertion)
# instead of extending the denylist to nine.
V5_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json || echo '"'"'quarantine failed'"'"''
WF=$(wf_with_e2e_step "$V5_STEP")
assert_exit 1 "V5: fails when the invocation is followed by || echo" "$WF"

V6_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: if bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json; then echo ok; else echo red; fi'
WF=$(wf_with_e2e_step "$V6_STEP")
assert_exit 1 "V6: fails when the invocation is wrapped in an if/then/else" "$WF"

# V7 exploits a flag this very branch introduces: --validate-only never reads
# a report and exits 0 having checked nothing against it.
V7_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json --validate-only'
WF=$(wf_with_e2e_step "$V7_STEP")
assert_exit 1 "V7: fails when the invocation appends --validate-only" "$WF"
# V8 is the same shape for THIS guard: it is a static-analysis check on the
# workflow yaml alone and never reads whatever the report path resolves to
# (green fixture or not), so V7's assertion already covers it.

V9_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          set +e
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          exit 0'
WF=$(wf_with_e2e_step "$V9_STEP")
assert_exit 1 "V9: fails when set +e and a trailing exit 0 override the invocation" "$WF"

# V9, isolated: `set +e` alone (no trailing exit) still disables the default
# errexit that makes the invocation's own failure fail the step.
V9_SET_ONLY_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          set +e
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$V9_SET_ONLY_STEP")
assert_exit 1 "V9: fails on set +e alone, with no trailing exit" "$WF"

# V9, isolated: a trailing exit alone (no set +e) — belt and braces, since a
# future default-shell change should not have to also weaken this check.
V9_EXIT_ONLY_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          exit 0'
WF=$(wf_with_e2e_step "$V9_EXIT_ONLY_STEP")
assert_exit 1 "V9: fails on a trailing exit alone, with no set +e" "$WF"

V10_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        shell: bash {0}
        run: |
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          echo done'
WF=$(wf_with_e2e_step "$V10_STEP")
assert_exit 1 "V10: fails when shell: bash {0} drops the default -e before a trailing echo" "$WF"

# V10, isolated: shell: bash {0} rejected even with no trailing line at all —
# the shell override itself is the problem, not just the echo it enables.
V10_SHELL_ONLY_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        shell: bash {0}
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$V10_SHELL_ONLY_STEP")
assert_exit 1 "V10: fails on shell: bash {0} alone" "$WF"
assert_contains "shell" "V10: names the shell override" "$WF"

# ── Two steps claiming the invocation is ambiguous, not doubly safe ─────────
DUPLICATE_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
      - name: Check quarantine again
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$DUPLICATE_STEP")
assert_exit 1 "fails when two steps both carry the quarantine invocation" "$WF"

# V11: an earlier, unrelated step happens to mention check-quarantine.sh (a
# "dry run" with --validate-only) and the real enforcing step was deleted.
# The old code used steps.find, first match wins — this must not.
V11_STEP='      - name: Quarantine dry run
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json --validate-only'
WF=$(wf_with_e2e_step "$V11_STEP")
assert_exit 1 "V11: fails when the only step mentioning the script is a decoy, not the real invocation" "$WF"
assert_contains "check-quarantine.sh" "V11: names the missing quarantine invocation" "$WF"

V12_STEP='      - name: Check quarantine
        env:
          GUARD: '"'"'true'"'"'
        run: |
          [ "$GUARD" = strict ] && bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json; echo skipped'
WF=$(wf_with_e2e_step "$V12_STEP")
assert_exit 1 "V12: fails when the invocation is conditioned on an env var and followed by echo skipped" "$WF"

# ── The positive assertion must not punish a genuinely inert comment ────────
# A `#` comment before the real invocation must still pass — `#` makes bash
# ignore the rest of THAT physical line outright, so nothing on it can
# neutralise anything. (Round 5, H1, dropped `echo` from this whitelist —
# see check-deploy-gating-quarantine-r5.test.sh for why.)
COMMENT_THEN_INVOKE_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          # running scripts/check-quarantine.sh
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$COMMENT_THEN_INVOKE_STEP")
assert_exit 0 "accepts a # comment line before the real invocation" "$WF"

# The real deploy.yml wraps the invocation's two args across lines with
# trailing backslashes — the positive assertion must recognise that shape too.
CONTINUATION_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          bash scripts/check-quarantine.sh \
            apps/frontend/e2e/quarantine.json \
            apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$CONTINUATION_STEP")
assert_exit 0 "accepts the real workflow's backslash line-continued invocation" "$WF"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
