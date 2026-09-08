#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-57).
# Run: bash scripts/check-deploy-gating.test.sh
#
# Fixtures are whole workflow skeletons rather than diffs of one another —
# the guard reads structure, so a fixture that is wrong in a way the test did
# not intend is worse than a slightly repetitive file.
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

echo "check-deploy-gating.sh"

# ── A correctly gated workflow ───────────────────────────────────────────────
GOOD='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
      cancel-in-progress: false
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  verify-prod-migrations:
    needs: [changes, deploy-supabase]
  deploy-edge-functions:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production, deploy-supabase, deploy-edge-functions]
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production, deploy-supabase]
    concurrency:
      group: production-deploy-solver'

assert_exit 0 "passes on a correctly gated workflow" "$GOOD"

# ── The regression this guard exists for ─────────────────────────────────────
UNGATED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-vercel:
    needs: [changes, deploy-supabase]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]'

assert_exit 1 "fails when a prod job does not need approve-production" "$UNGATED"
assert_contains "deploy-vercel does not depend on approve-production" \
  "names the ungated job" "$UNGATED"

# ── Gate present but never pauses ────────────────────────────────────────────
NO_ENV='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes, deploy-qa]
    runs-on: ubuntu-latest
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-vercel:
    needs: [changes, approve-production]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]'

assert_exit 1 "fails when approve-production has no environment" "$NO_ENV"

# ── Gate does not wait for QA ────────────────────────────────────────────────
NO_QA='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
  deploy-vercel:
    needs: [changes, approve-production]
  deploy-worker:
    needs: [changes, approve-production]
  deploy-agents:
    needs: [changes, approve-production]
  deploy-solver:
    needs: [changes, approve-production]'

assert_exit 1 "fails when approve-production does not need deploy-qa" "$NO_QA"

# ── Gate missing entirely (the pre-spec-57 state) ────────────────────────────
NO_GATE='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  deploy-vercel:
    needs: [changes]'

assert_exit 1 "fails when the gate job is absent" "$NO_GATE"
assert_contains "missing job: approve-production" "names the missing gate" "$NO_GATE"

# ── Shape tolerance: object-form environment and scalar needs ────────────────
OBJECT_ENV='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: changes
    concurrency: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment:
      name: production
      url: https://aureon.tractis.ai
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency: production-deploy-solver'

assert_exit 0 "accepts the object form of environment:" "$OBJECT_ENV"

# ── QA must not be starved by a pending approval ─────────────────────────────
# A workflow-level concurrency group covers EVERY job, deploy-qa included. A run
# paused at approve-production keeps holding that group, so the next merge's QA
# sync cannot start — QA silently falls behind main for as long as nobody clicks
# approve. Observed 2026-08-16: #424 sat pending while #426 waited on approval.
WORKFLOW_CONCURRENCY='concurrency:
  group: production-deploy
  cancel-in-progress: false
jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 1 "fails on a workflow-level concurrency group" "$WORKFLOW_CONCURRENCY"
assert_contains "workflow-level concurrency" \
  "explains that it starves deploy-qa" "$WORKFLOW_CONCURRENCY"

# ── Production still serialised, per job ─────────────────────────────────────
UNSERIALISED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 1 "fails when a prod job has no concurrency group of its own" "$UNSERIALISED"
assert_contains "deploy-supabase" "names the unserialised job" "$UNSERIALISED"

# ── QA sync must not race itself on the VPS ──────────────────────────────────
QA_UNSERIALISED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 1 "fails when deploy-qa has no concurrency group" "$QA_UNSERIALISED"
assert_contains "deploy-qa" "names deploy-qa" "$QA_UNSERIALISED"

# ── needs: is not enough when if: uses always() ──────────────────────────────
# Observed 2026-08-17, run 32066950544: approve-production was SKIPPED (its own
# needs had been cancelled), and deploy-vercel ran `vercel --prod` anyway. It
# listed the gate in needs:, so the guard above was satisfied — but always()
# overrides the implicit "a skipped need skips the job", and a skipped job is
# neither failure() nor cancelled(). Production shipped with nobody approving.
#
# So a prod job that opts into always() must say out loud that the gate passed.
ALWAYS_BYPASS='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled()
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled()
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled()
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 1 "fails when always() lets a skipped gate through" "$ALWAYS_BYPASS"
assert_contains "deploy-vercel" "names the job that can bypass the gate" "$ALWAYS_BYPASS"

# The same shape, but each always() job asserts the gate actually succeeded.
# This is the form the real workflow has to use: the other needs (deploy-supabase,
# deploy-edge-functions) are legitimately skipped by the path filters, so plain
# success() semantics are not available — always() has to stay.
ALWAYS_GATED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
  deploy-supabase:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-supabase
  deploy-edge-functions:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    if: always() && !failure() && !cancelled() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    if: always() && needs.approve-production.result == '"'"'success'"'"'
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 0 "accepts always() when the gate result is asserted" "$ALWAYS_GATED"

# ── deploy-supabase path-filtered ────────────────────────────────────────────
# The shape production actually drifted in: a migration's run waits at the gate,
# docs-only merges land behind it, and the run that finally gets approved has no
# migration in its diff — so the job skips and nothing deploys.
PATH_FILTERED='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  approve-production:
    needs: [changes, deploy-qa]
    environment: production
    runs-on: ubuntu-latest
  deploy-supabase:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-supabase
    if: |
      needs.approve-production.result == '"'"'success'"'"' &&
      needs.changes.outputs.database == '"'"'true'"'"'
  deploy-edge-functions:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-edge-functions
  deploy-vercel:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-vercel
  deploy-worker:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-worker
  deploy-agents:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-agents
  deploy-solver:
    needs: [changes, approve-production]
    concurrency:
      group: production-deploy-solver'

assert_exit 1 "fails when deploy-supabase is path-filtered" "$PATH_FILTERED"
assert_contains "path-filtered on changes.outputs.database" \
  "explains why the filter is the bug" "$PATH_FILTERED"

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
# wf_with_e2e_step <step-yaml-indented-6-spaces> -> full workflow on stdout
wf_with_e2e_step() {
  local step="$1"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n    needs: [changes, deploy-qa]\n    steps:\n'
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

# ── The positive assertion must not punish legitimate logging ───────────────
# A step that logs before running the real check must still pass — punishing
# it teaches people to strip logging from around the guard.
LOG_THEN_INVOKE_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          echo '"'"'running scripts/check-quarantine.sh'"'"'
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$LOG_THEN_INVOKE_STEP")
assert_exit 0 "accepts a log line before the real invocation" "$WF"

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

# ── Bad input ────────────────────────────────────────────────────────────────
if bash "$SCRIPT" "$TMP/does-not-exist.yml" >/dev/null 2>&1; then
  fail=$((fail + 1)); echo "  FAIL exits non-zero on a missing workflow file"
else
  pass=$((pass + 1)); echo "  ok   exits non-zero on a missing workflow file"
fi

# ── The real workflow must pass ──────────────────────────────────────────────
REAL="$(dirname "$0")/../.github/workflows/deploy.yml"
if bash "$SCRIPT" "$REAL" >/dev/null 2>&1; then
  pass=$((pass + 1)); echo "  ok   the committed deploy.yml is correctly gated"
else
  fail=$((fail + 1)); echo "  FAIL the committed deploy.yml is NOT correctly gated"
  bash "$SCRIPT" "$REAL" 2>&1 | sed 's/^/         /'
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
