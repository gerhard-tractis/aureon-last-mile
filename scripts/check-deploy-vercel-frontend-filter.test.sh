#!/usr/bin/env bash
#
# Pins the contents of deploy.yml's frontend= path filter (the `changes` job,
# consumed by deploy-vercel and by deploy-qa.sh's CHANGED_FRONTEND).
#
# check-deploy-gating.mjs asserts the SHAPE of the gating (needs/if/
# concurrency) but is blind to what a path-filter regex actually matches —
# nothing stops a future edit from "simplifying" frontend= back down to
# `^apps/frontend/` alone. That would silently reintroduce the exact bug this
# guard exists for: a root package-lock.json bump (a frontend dependency
# version change with no diff under apps/frontend/) would then leave
# deploy-vercel skipped and production serving the old bundle, green the
# whole way.
#
# This test reads the REAL .github/workflows/deploy.yml (not a synthetic
# fixture, unlike its siblings) because the thing being guarded is the
# regex's actual content, not a structural shape you can reconstruct in a
# minimal YAML string.
#
# Run: bash scripts/check-deploy-vercel-frontend-filter.test.sh
set -uo pipefail

WORKFLOW="$(cd "$(dirname "$0")/.." && pwd)/.github/workflows/deploy.yml"
pass=0
fail=0

echo "deploy.yml — frontend= path filter contents"

# Pull the FRONTEND_PATTERN='...' line out of the Filter paths step. Fails
# loudly (not silently-empty) if that variable is ever renamed or removed.
PATTERN_LINE="$(grep -m1 "FRONTEND_PATTERN=" "$WORKFLOW" || true)"

if [ -z "$PATTERN_LINE" ]; then
  echo "  FAIL no FRONTEND_PATTERN= assignment found in $WORKFLOW"
  echo "       (did the frontend filter get renamed or inlined again?)"
  fail=$((fail + 1))
else
  echo "  ok   FRONTEND_PATTERN= assignment found"
  pass=$((pass + 1))
fi

# assert_has <needle> <description>
assert_has() {
  local needle="$1" desc="$2"
  if printf '%s' "$PATTERN_LINE" | grep -qF -- "$needle"; then
    pass=$((pass + 1))
    echo "  ok   filter still covers: $desc"
  else
    fail=$((fail + 1))
    echo "  FAIL filter no longer covers: $desc (expected to find: $needle)"
  fi
}

# The original, narrow filter — must still be the base of the pattern.
assert_has '^apps/frontend/' 'apps/frontend/ itself'

# Root files that pin dependency versions frontend builds against. A bump
# here has no diff under apps/frontend/ at all.
assert_has 'package-lock\.json' 'root package-lock.json (dependency version pins)'
assert_has 'package\.json' 'root package.json'

# The build pipeline definition frontend's `turbo run build` follows.
assert_has 'turbo\.json' 'turbo.json'

# packages/database/src/ — apps/frontend consumes the generated Supabase
# types from there (via next.config.ts's transpilePackages), so a change
# there can change frontend type-checking/build output with zero diff under
# apps/frontend/.
assert_has 'packages/database/' 'packages/database/'
assert_has 'src/' 'packages/database/src/ (where the generated types live)'

# force_frontend: the escape hatch for when the filter (correctly) says
# false but production still needs a manual catch-up deploy.
if grep -q 'force_frontend' "$WORKFLOW"; then
  pass=$((pass + 1))
  echo "  ok   force_frontend workflow_dispatch override is present"
else
  fail=$((fail + 1))
  echo "  FAIL force_frontend workflow_dispatch override is missing"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
