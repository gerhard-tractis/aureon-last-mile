#!/usr/bin/env bash
#
# check-deploy-gating-quarantine-differential.test.sh (spec-87 fase 1,
# re-review round 7)
#
# Strategy change, not another round of one-test-per-vector: rounds 4-6 each
# found a bypass by hand, wrote one test for it, and the next round found
# another the previous tests didn't cover. The re-reviewer built a
# differential harness instead — it runs the CANDIDATE vector under real
# bash (the same interpreter GitHub Actions uses to run a `run:` step), with
# a stub `check-quarantine.sh` that always fails, and asserts the vector is
# a REAL, live bypass in bash (the stub's failure gets silently swallowed).
# Only THEN does it check the guard rejects the same vector's step shape.
#
# That combination is the point: a vector that isn't a genuine bash bypass
# doesn't belong here (it would only prove the guard is stricter than it
# needs to be, which is a different, lower-stakes question — see spec-87's
# fase 1 section on fail-closed divergences). From here on, a new vector
# gets added to THIS harness, not a new -rN.test.sh file, unless it needs a
# YAML/resolution-chain fixture (job/workflow `defaults:`) that has nothing
# to do with what bash actually executes — those stay as plain
# check-deploy-gating.sh assertions, e.g. in check-deploy-gating-quarantine-r6.test.sh.
#
# Run: bash scripts/check-deploy-gating-quarantine-differential.test.sh
#
set -uo pipefail

SCRIPT="$(dirname "$0")/check-deploy-gating.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

# Runs $1 (the exact text a step's `run:` would contain) as a real bash
# script, in a scratch directory that has a stub scripts/check-quarantine.sh
# — one that always exits 1, standing in for a quarantine check that found a
# real, unforgiven failure. Echoes bash's own exit code.
real_bash_exit_code() {
  local run_script="$1" dir rc
  dir="$TMP/real-$RANDOM"
  mkdir -p "$dir/scripts"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$dir/scripts/check-quarantine.sh"
  chmod +x "$dir/scripts/check-quarantine.sh"
  printf '%s' "$run_script" > "$dir/run.sh"
  ( cd "$dir" && bash --noprofile --norc -e -o pipefail run.sh ) > /dev/null 2>&1
  rc=$?
  rm -rf "$dir"
  echo "$rc"
}

# Wraps $1 as the veto step's run: inside a minimal, otherwise-clean e2e-qa
# job and returns check-deploy-gating.sh's exit code for it.
guard_exit_code() {
  local run_script="$1" yaml_step
  yaml_step="      - name: Check quarantine
        if: steps.qa.outputs.provisioned == 'true'
        working-directory: .
        run: |
$(printf '%s\n' "$run_script" | sed 's/^/          /')"
  {
    printf 'jobs:\n'
    printf '  changes:\n    runs-on: ubuntu-latest\n'
    printf '  deploy-qa:\n    needs: [changes]\n    concurrency:\n      group: qa-deploy\n'
    printf '  e2e-qa:\n    needs: [changes, deploy-qa]\n    steps:\n'
    printf '      - name: Run E2E against QA\n        run: npm run e2e:qa || true\n'
    printf '%s\n' "$yaml_step"
    printf '  approve-production:\n    needs: [changes, deploy-qa, e2e-qa]\n    environment: production\n'
    for j in supabase edge-functions vercel worker agents solver; do
      printf '  deploy-%s:\n    needs: [changes, approve-production]\n    concurrency:\n      group: production-deploy-%s\n' "$j" "$j"
    done
  } > "$TMP/wf.yml"
  bash "$SCRIPT" "$TMP/wf.yml" > /dev/null 2>&1
  echo $?
}

assert_real_bypass_is_rejected() {
  local name="$1" run_script="$2" bash_rc guard_rc
  bash_rc=$(real_bash_exit_code "$run_script")
  guard_rc=$(guard_exit_code "$run_script")
  if [ "$bash_rc" -ne 0 ] && [ "$guard_rc" -eq 0 ]; then
    # The vector isn't actually a live bash bypass against a failing stub —
    # it doesn't belong in this harness (see header). Report it loudly
    # rather than silently passing.
    fail=$((fail + 1))
    echo "  FAIL $name — not a real bash bypass (bash exit $bash_rc), skip it from this harness"
    return
  fi
  if [ "$bash_rc" -eq 0 ] && [ "$guard_rc" -ne 0 ]; then
    pass=$((pass + 1))
    echo "  ok   $name (bash silently swallowed the failing stub, guard rejected the step)"
  else
    fail=$((fail + 1))
    echo "  FAIL $name — bash exit $bash_rc, guard exit $guard_rc (guard must reject whenever bash swallows the failure)"
  fi
}

echo "check-deploy-gating.sh — differential harness against real bash (round 7)"

# ── ALLOWED_EXTRA_LINE anchor: a trap statement with a trailing bash comment
# is not itself a comment line — bash executes the trap and then, separately,
# ignores everything from `#` onward on THAT line. `/^#/` correctly rejects
# it (the line does not START with `#`); an unanchored `/#/` would wrongly
# tolerate it because a `#` appears somewhere in the string.
assert_real_bypass_is_rejected \
  "trap with a trailing '# ...' comment is a live bypass and must stay rejected" \
  "trap 'exit 0' EXIT # x
bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
