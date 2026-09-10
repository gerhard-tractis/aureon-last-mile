#!/usr/bin/env bash
#
# Pins the contents of deploy.yml's frontend= path filter (the `changes` job,
# consumed by deploy-vercel and by deploy-qa.sh's CHANGED_FRONTEND) AND the
# force_frontend workflow_dispatch override.
#
# check-deploy-gating.mjs asserts the SHAPE of the gating (needs/if/
# concurrency) but is blind to what a path-filter regex actually matches, and
# has zero mentions of "frontend"/"force_" at all (grep it — it only knows
# deploy-vercel as a job NAME). Nothing else in CI stops a future edit from
# "simplifying" frontend= back down to `^apps/frontend/`, or from quietly
# dropping force_frontend. That would silently reintroduce the exact bug this
# guard exists for: a root package-lock.json bump (a frontend dependency
# version change with no diff under apps/frontend/) would then leave
# deploy-vercel skipped and production serving the old bundle, green the
# whole way — with no manual recovery path either.
#
# This test reads the REAL .github/workflows/deploy.yml (not a synthetic
# fixture, unlike check-deploy-gating.sh's tests) because the thing being
# guarded is exact literal content, not a structural shape you can
# reconstruct in a minimal YAML string.
#
# ROUND 3 REVIEW FIX: v1 of this test asserted only against the
# FRONTEND_PATTERN='...' *assignment* line, never against the line that
# actually EMITS `frontend=`. Three mutations survived at 8/8 green:
#   - deleting `^package\.json$` (its needle substring also occurs inside
#     `packages/database/(package\.json$`, so the assertion stayed satisfied)
#   - deleting the entire force_frontend input+env+override (a bare
#     `grep -q force_frontend` still matched the surrounding PROSE COMMENTS)
#   - leaving FRONTEND_PATTERN declared but changing the line that computes
#     FRONTEND to ignore it entirely (a dead variable — v1 never asserted
#     FRONTEND_PATTERN was actually CONSUMED, or that the final `echo
#     "frontend=..."` used the computed value at all)
# Every assertion below now targets either an anchored needle or the exact
# functional line, not a needle that can be satisfied by unrelated text.
#
# Run: bash scripts/check-deploy-vercel-frontend-filter.test.sh
set -uo pipefail

WORKFLOW="$(cd "$(dirname "$0")/.." && pwd)/.github/workflows/deploy.yml"
pass=0
fail=0

echo "deploy.yml — frontend= path filter + force_frontend override"

# assert_has_exact <needle> <description> — literal substring match (-F), so
# regex metacharacters in the needle are not reinterpreted.
assert_has_exact() {
  local needle="$1" desc="$2"
  if grep -qF -- "$needle" "$WORKFLOW"; then
    pass=$((pass + 1))
    echo "  ok   $desc"
  else
    fail=$((fail + 1))
    echo "  FAIL $desc (expected to find literally: $needle)"
  fi
}

# ── The pattern is actually consumed, not a dead variable ────────────────────
# Anchors on the two specific statements that connect FRONTEND_PATTERN to the
# output GitHub Actions reads. Without both, a future edit could declare
# FRONTEND_PATTERN, never use it to compute FRONTEND, and this test would
# have no way to know.
assert_has_exact 'FRONTEND=$(matches "$FRONTEND_PATTERN")' \
  'FRONTEND is computed from FRONTEND_PATTERN (not a dead variable)'
assert_has_exact 'echo "frontend=${FRONTEND}"' \
  'the emitted frontend= output uses the computed FRONTEND (not a re-derived literal)'

# ── Pattern contents — anchored so a needle can''t hide inside another term ──
PATTERN_LINE="$(grep -m1 "FRONTEND_PATTERN=" "$WORKFLOW" || true)"
if [ -z "$PATTERN_LINE" ]; then
  echo "  FAIL no FRONTEND_PATTERN= assignment found in $WORKFLOW"
  fail=$((fail + 1))
else
  pass=$((pass + 1))
  echo "  ok   FRONTEND_PATTERN= assignment found"
fi

# assert_pattern_has <needle> <description> — checked against PATTERN_LINE
# only, so these can't accidentally match the surrounding shell/comments.
assert_pattern_has() {
  local needle="$1" desc="$2"
  if printf '%s' "$PATTERN_LINE" | grep -qF -- "$needle"; then
    pass=$((pass + 1))
    echo "  ok   filter still covers: $desc"
  else
    fail=$((fail + 1))
    echo "  FAIL filter no longer covers: $desc (expected to find: $needle)"
  fi
}

assert_pattern_has '^apps/frontend/' 'apps/frontend/ itself'
assert_pattern_has '^package-lock\.json$' 'root package-lock.json (dependency version pins)'
# Anchored with the surrounding pipes so this can't be satisfied by the
# `(package\.json$` term nested inside the packages/database/ alternation —
# that one is preceded by `(`, never by `|`.
assert_pattern_has '|^package\.json$|' 'root package.json (anchored, distinct from packages/database/(package.json$)'
assert_pattern_has '^turbo\.json$' 'turbo.json'
assert_pattern_has 'packages/database/' 'packages/database/'
assert_pattern_has 'src/' 'packages/database/src/ (where the generated types live)'

# ── force_frontend: functional lines, not prose mentions ────────────────────
# The workflow_dispatch input declaration (mirrors force_db's shape).
if grep -A3 'force_frontend:' "$WORKFLOW" | grep -q 'type: boolean'; then
  pass=$((pass + 1))
  echo "  ok   force_frontend workflow_dispatch input is declared as boolean"
else
  fail=$((fail + 1))
  echo "  FAIL force_frontend workflow_dispatch input (with type: boolean) not found"
fi

assert_has_exact 'FORCE_FRONTEND: ${{ inputs.force_frontend }}' \
  'FORCE_FRONTEND env wiring from the dispatch input'

# The override's if-line AND that its body actually sets FRONTEND=true — a
# bare `grep -q force_frontend` (round 2's version) is satisfied by comment
# prose alone once the real if/env/input trio is deleted.
if grep -A3 -F 'if [ "${FORCE_FRONTEND}" = "true" ]' "$WORKFLOW" | grep -qF 'FRONTEND=true'; then
  pass=$((pass + 1))
  echo "  ok   force_frontend override block actually sets FRONTEND=true"
else
  fail=$((fail + 1))
  echo "  FAIL force_frontend override block (if [ \"\${FORCE_FRONTEND}\" = \"true\" ] ... FRONTEND=true) not found"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
