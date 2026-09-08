#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-87 fase 1, re-review round 4) —
# vectors that survived round 3's denylist (B1/B2/B3), a generic
# whitelist-of-the-class test, and step ordering (M4). Split from
# check-deploy-gating-quarantine.test.sh to stay under the repo's 300-line
# guideline; the fixture factory is duplicated here rather than sourced,
# matching how check-quarantine's own split test files work.
# Run: bash scripts/check-deploy-gating-quarantine-r4.test.sh
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

echo "check-deploy-gating.sh — quarantine veto step (round 4)"

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

# ── Re-review round 4: the invocation is a positive assertion of a SHAPE ────
# (whitelist: only the invocation itself, comments, and echo lines), not an
# enumeration of forbidden operators. B1/B2/B3 below are three NEW vectors
# the round-3 denylist (`set +e`, `set +o errexit`, `exit`) missed entirely;
# the generic test after them proves the fix is a whitelist, not four more
# denylist entries.

CLEAN_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'

# B1 (job-level): defaults.run.shell on the e2e-qa JOB overrides the step's
# shell exactly like an explicit shell: on the step would — check-deploy-
# gating.mjs only ever read quarantineStep.shell and never looked at
# defaults: at all.
JOB_DEFAULTS_SHELL='    defaults:
      run:
        shell: bash {0}'
WF=$(wf_with_e2e_step "$CLEAN_STEP" "$JOB_DEFAULTS_SHELL")
assert_exit 1 "B1: fails when the e2e-qa job's defaults.run.shell overrides bash" "$WF"
assert_contains "shell" "B1: names the shell override at job level" "$WF"

# B1 (workflow-level): the same override one level higher, on defaults: at
# the top of the workflow document — covers every job, e2e-qa included.
WF_BODY=$(wf_with_e2e_step "$CLEAN_STEP")
WORKFLOW_LEVEL_SHELL="defaults:
  run:
    shell: bash {0}
$WF_BODY"
assert_exit 1 "B1: fails when workflow-level defaults.run.shell overrides bash" "$WORKFLOW_LEVEL_SHELL"
assert_contains "shell" "B1: names the shell override at workflow level" "$WORKFLOW_LEVEL_SHELL"

# B2: `trap 'exit 0' EXIT` needs no `set +e` and no `shell:` override at all —
# under the default `-eo pipefail`, errexit on the invocation's failure fires
# the trap, and the trap runs `exit 0`, turning the step green regardless.
TRAP_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          trap '"'"'exit 0'"'"' EXIT
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$TRAP_STEP")
assert_exit 1 "B2: fails when a trap on EXIT swallows the invocation's exit code" "$WF"

# B3, variant 1: the round-3 denylist compared by exact string equality to
# 'set +e' — 'set +ex' (still turns off errexit) walks straight past it.
SET_PLUS_EX_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          set +ex
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          echo done'
WF=$(wf_with_e2e_step "$SET_PLUS_EX_STEP")
assert_exit 1 "B3: fails on set +ex, a variant the exact-string denylist did not know" "$WF"

# B3, variant 2: same idea, `set +e -u` (two flags in one invocation) followed
# by a bare `true` rather than `echo`/`exit`.
SET_PLUS_E_U_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          set +e -u
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          true'
WF=$(wf_with_e2e_step "$SET_PLUS_E_U_STEP")
assert_exit 1 "B3: fails on set +e -u followed by a bare true" "$WF"

# Generic: the class, not the case. A completely unanticipated line — nothing
# to do with set/trap/exit — must also fail, because the run: is only allowed
# to contain the invocation, comments, and echo lines. Anything else is
# outside the whitelist by construction, with nobody having to have predicted
# it first.
UNANTICIPATED_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          while false; do :; done'
WF=$(wf_with_e2e_step "$UNANTICIPATED_STEP")
assert_exit 1 "generic: fails on an arbitrary line nobody enumerated in advance" "$WF"

# m6: the whitelist still tolerates re-flowed whitespace WITHIN the
# invocation line itself — collapsing runs of spaces is what makes this a
# shape check rather than a byte-for-byte diff.
EXTRA_WHITESPACE_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash  scripts/check-quarantine.sh  apps/frontend/e2e/quarantine.json  apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$EXTRA_WHITESPACE_STEP")
assert_exit 0 "m6: extra internal whitespace in the invocation still matches" "$WF"

# ── M4: the veto step must run AFTER the step that actually runs Playwright ──
# The guard never looked at step order. Moving "Check quarantine" before "Run
# E2E against QA" leaves the guard green while the step reads whatever
# results.json a PREVIOUS run left on the self-hosted runner's disk — a
# perpetual pass that never executes anything.
WRONG_ORDER='jobs:
  changes:
    runs-on: ubuntu-latest
  deploy-qa:
    needs: [changes]
    concurrency:
      group: qa-deploy
  e2e-qa:
    needs: [changes, deploy-qa]
    steps:
      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
      - name: Run E2E against QA
        run: npm run e2e:qa || true
  approve-production:
    needs: [changes, deploy-qa, e2e-qa]
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
assert_exit 1 "M4: fails when Check quarantine runs before Run E2E against QA" "$WRONG_ORDER"
assert_contains "before" "M4: explains the ordering requirement" "$WRONG_ORDER"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
