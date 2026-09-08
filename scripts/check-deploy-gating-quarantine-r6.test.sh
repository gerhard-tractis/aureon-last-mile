#!/usr/bin/env bash
#
# Tests for check-deploy-gating.sh (spec-87 fase 1, re-review round 6) — B1
# (logicalLines() joined on a laxer rule than bash: it trimmed before
# checking for a trailing backslash and never counted parity, so a `#`
# comment ending in `\\` or `\ ` could swallow the next physical line
# instead of the guard treating it as inert) and M4 (working-directory had
# no resolution chain while shell already did). Split from
# check-deploy-gating-quarantine-r5.test.sh to stay under the repo's
# 300-line guideline; the fixture factory is duplicated here, matching how
# the other split test files in this family work.
# Run: bash scripts/check-deploy-gating-quarantine-r6.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/check-deploy-gating.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

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

echo "check-deploy-gating.sh — quarantine veto step (round 6)"

wf_with_e2e_step() {
  local step="$1" job_extra="${2:-}" e2e_step="${3:-      - name: Run E2E against QA
        run: npm run e2e:qa || true}"
  printf 'jobs:\n'
  printf '  changes:\n    runs-on: ubuntu-latest\n'
  printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
  printf '  e2e-qa:\n    needs: [changes, deploy-qa]\n'
  if [ -n "$job_extra" ]; then
    printf '%s\n' "$job_extra"
  fi
  printf '    steps:\n'
  if [ "$e2e_step" != "NONE" ]; then
    printf '%s\n' "$e2e_step"
  fi
  printf '%s\n' "$step"
  printf '  approve-production:\n    needs: [changes, deploy-qa, e2e-qa]\n    environment: production\n'
  for j in supabase edge-functions vercel worker agents solver; do
    printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
  done
}

CLEAN_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'

# ── B1 vector 11a: a comment ending in an EVEN number of trailing backslashes
# does not continue in real bash (verified live with
# `bash --noprofile --norc -e -o pipefail`: `# note \\` followed by a `trap`
# statement runs the trap as its own statement, it does not get swallowed
# into the comment). The old logicalLines() trimmed before checking
# `endsWith('\\')`, saw one backslash regardless of how many were actually
# there, and joined — hiding the `trap` line inside the whitelisted `#` line.
V11A_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          # nota \\
          trap '"'"'exit 0'"'"' EXIT
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$V11A_STEP")
assert_exit 1 "11a: a comment ending in \\\\ does not swallow the next line's trap" "$WF"

# ── B1 vector 11b: a comment ending in a backslash followed by a trailing
# space does not continue either (the backslash is not immediately adjacent
# to the newline). The old code's `raw.trim()` (line 36) silently deleted
# that trailing space before the endsWith check, joining anyway.
V11B_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: |
          # nota volatil \
          trap '"'"'exit 0'"'"' EXIT
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$V11B_STEP")
assert_exit 1 "11b: a comment ending in backslash+space does not swallow the next line's trap" "$WF"

# ── Corollary: the same defect broke the H2 anchor. A decoy step running
# AFTER the real Playwright step, whose run: is a `# rerun \\`-style comment
# joined (under the old rule) with a genuine `npm run e2e:qa` invocation,
# must not move the anchor past the quarantine step.
COROLLARY_DECOY='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
      - name: Rerun decoy
        run: |
          # rerun \\
          npm run e2e:qa || true'
WF=$(wf_with_e2e_step "$COROLLARY_DECOY")
assert_exit 1 "corollary: a comment-joined decoy npm run e2e:qa after the veto still fails the order check" "$WF"

# ── Legitimate continuation must keep working: deploy.yml's real step wraps
# its two args across three lines with single trailing backslashes (odd
# count, immediately adjacent to the newline) — that MUST still join into
# one logical line and pass. This is deploy.yml's actual shape
# (.github/workflows/deploy.yml:656-659), reproduced verbatim.
MULTILINE_CONTINUATION_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: |
          bash scripts/check-quarantine.sh \
            apps/frontend/e2e/quarantine.json \
            apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$MULTILINE_CONTINUATION_STEP")
assert_exit 0 "single-backslash continuation (the real deploy.yml shape) still joins and passes" "$WF"

# ── Mutation-kill: trailing backslash + trailing space on a NON-comment
# line must not continue either (11b generalised beyond comments). If the
# backslash-count check ever trims the line first, this reconstructs the
# exact expected invocation from two lines that must NOT join — a real
# bypass, not a synthetic one: the guard would flip from correctly failing
# (dangling backslash on its own unmatched line) to incorrectly passing.
TRAILING_SPACE_NONCOMMENT_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: |
          bash scripts/check-quarantine.sh \ 
          apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$TRAILING_SPACE_NONCOMMENT_STEP")
assert_exit 1 "mutation-kill: a non-comment line ending in backslash+space does not join with the next" "$WF"

# ── B2: the guard analyses the template, GitHub executes the expansion. A
# `${{ ... }}` inside the tolerated `#` line is invisible to this guard
# today but is substituted by GitHub BEFORE bash ever reads the line — a
# multi-line expression value (e.g. a commit message) can turn that single
# comment line into comment + statement at runtime. Reject any `${{` in the
# veto step's run: outright, whitelist or not.
TEMPLATE_IN_COMMENT_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: |
          # ${{ github.event.head_commit.message }}
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$TEMPLATE_IN_COMMENT_STEP")
assert_exit 1 "B2: a \${{ ... }} template expression anywhere in the veto step's run: is rejected" "$WF"

# ── Round 7: the `${{` rejection needs its own message. Before this, a step
# with a template expression fell through to the generic "no step whose run:
# is exactly ..." error, byte-for-byte identical to the invocation it was
# comparing against — the next person to read that message would spend time
# diffing two strings that already match, never learning `${{` was the real
# cause.
assert_contains 'contains `${{' \
  "round 7: the \${{ rejection names itself, not the generic no-valid-step message" "$WF"


# chain as shell already had. The real step pins working-directory: . — a
# job-level (or workflow-level) defaults.run.working-directory that moves it
# elsewhere must fail loudly instead of being invisible to this guard.
JOB_LEVEL_WD='    defaults:
      run:
        working-directory: apps/frontend'
STEP_NO_WD='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$STEP_NO_WD" "$JOB_LEVEL_WD")
assert_exit 1 "M4: a job-level defaults.run.working-directory moving the veto step is rejected" "$WF"

# The explicit working-directory: . on the step itself (the real deploy.yml
# shape) must still pass.
WF=$(wf_with_e2e_step "$CLEAN_STEP")
assert_exit 0 "M4: an explicit working-directory: . on the veto step still passes" "$WF"

# ── Round 7: M4 was only ever tested at JOB level (JOB_LEVEL_WD above).
# effectiveWorkingDirectory() also falls back to a WORKFLOW-level
# defaults.run.working-directory when neither the step nor the job set one —
# that branch (`if (wfWd != null) return wfWd;`) had no test moving it, so a
# mutant deleting it survived. wf_with_e2e_step has no hook for a top-level
# `defaults:` key (it only injects at job level via job_extra), so this
# builds the document directly instead of reusing the helper.
WORKFLOW_LEVEL_WD_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF="defaults:
  run:
    working-directory: apps/frontend
$(wf_with_e2e_step "$WORKFLOW_LEVEL_WD_STEP")"
assert_exit 1 "round 7: a WORKFLOW-level defaults.run.working-directory moving the veto step is rejected" "$WF"

# ── Round 7: the step-level working-directory check (`if
# (step['working-directory'] != null)`) had no test where deleting it would
# change the outcome — the real deploy.yml fixture happens to set
# working-directory: . on the step AND resolve to '.' by the base case too,
# so removing the step-level branch was invisible against that one fixture.
# Here the step pins an explicit, WRONG working-directory while neither the
# job nor the workflow sets any default (so the fallback base case is '.') —
# only reading the step's own value catches the mismatch.
STEP_LEVEL_WD_WRONG_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: apps/frontend
        run: bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$STEP_LEVEL_WD_WRONG_STEP")
assert_exit 1 "round 7: an explicit step-level working-directory other than . is rejected even with no job/workflow default to fall back to" "$WF"

# ── Round 7: coverage for the trailing-backslash PARITY branch (logicalLines
# :63-64) on a NON-comment line. 11a/11b (above) both exercise parity only
# through the comment early-return (:57) — a comment is terminal regardless
# of backslash count, so neither test can tell the parity check apart from
# "comments never continue". This is a genuinely even (non-continuing) count
# on an ordinary, non-comment line: it must NOT join with the next line, so
# the two halves stay as two separate logical lines and neither matches the
# expected invocation — the run: is rejected. (The odd-count non-comment case
# is already covered by MULTILINE_CONTINUATION_STEP passing, and the
# single-backslash-plus-space case by TRAILING_SPACE_NONCOMMENT_STEP; this
# fills the even-count gap the re-review pointed out.)
EVEN_BACKSLASH_NONCOMMENT_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: |
          bash scripts/check-quarantine.sh \\
          apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json'
WF=$(wf_with_e2e_step "$EVEN_BACKSLASH_NONCOMMENT_STEP")
assert_exit 1 "round 7: an EVEN trailing-backslash count on a non-comment line does not continue (parity, not just presence)" "$WF"

# ── Round 7: the final flush (`if (buf) lines.push(...)`) has no test moving
# it. It matters only for the run:'s LAST physical line, when that line ends
# in an odd (continuing) backslash count with no following line to join —
# `run: |-` (block chomping) delivers exactly that shape verbatim, with
# nothing trimmed. Here the invocation is a clean, complete first line, and a
# `trap` statement is the dangling, backslash-terminated LAST line with no
# trailing newline. Dropping the flush would silently discard that trap line
# from `lines` entirely, leaving only the invocation behind — an accidental
# ACCEPT of a run: that plants a trap. With the flush (current code), the
# trap line survives into `lines`, fails the `#`-only whitelist for anything
# beyond the invocation, and the guard correctly rejects.
BUF_FLUSH_STEP='      - name: Check quarantine
        if: steps.qa.outputs.provisioned == '"'"'true'"'"'
        working-directory: .
        run: |-
          bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json
          trap '"'"'exit 0'"'"' EXIT \'
WF=$(wf_with_e2e_step "$BUF_FLUSH_STEP")
assert_exit 1 "round 7: a dangling, backslash-terminated trap as the run:'s final unflushed line is rejected" "$WF"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
