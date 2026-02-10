#!/bin/bash
# Task 6.4: Create CI Pipeline Test PR
# This script creates a test PR to verify the CI pipeline works correctly

set -e

REPO_OWNER="gerhard-tractis"
REPO_NAME="aureon-last-mile"
BRANCH="test/ci-pipeline-verification"
BASE="main"

echo "🧪 Creating CI Pipeline Test PR..."
echo ""

# Check if gh CLI is authenticated
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ GitHub CLI not authenticated. Please run:"
  echo "   gh auth login"
  echo ""
  echo "📝 Alternative: Create PR manually at:"
  echo "   https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/new/${BRANCH}"
  echo ""
  exit 1
fi

echo "✅ GitHub CLI authenticated"
echo ""

# Check if PR already exists
EXISTING_PR=$(gh pr list --head "$BRANCH" --base "$BASE" --json number --jq '.[0].number' 2>/dev/null || echo "")

if [ -n "$EXISTING_PR" ]; then
  echo "ℹ️  PR already exists: #${EXISTING_PR}"
  echo "🔗 https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${EXISTING_PR}"
  echo ""
  echo "📊 Checking CI status..."
  gh pr checks "$EXISTING_PR"
  exit 0
fi

# Create PR
echo "📝 Creating pull request..."
PR_URL=$(gh pr create \
  --title "test: CI Pipeline Verification (Task 6.4)" \
  --body "## CI Pipeline Test

This PR verifies the CI pipeline configured in Task 6.1-6.2.

### Expected CI Checks:
- ✅ Type-check (TypeScript)
- ✅ Lint (ESLint)
- ✅ Test with coverage (Vitest - 70% threshold)
- ✅ Build verification
- ✅ Matrix testing (Node 20.x, 22.x)

### Test Files:
- Added \`.github/CI-TEST.md\` to trigger CI workflow

### Related:
- Task 6.4: Test CI/CD pipeline
- ADR-005: CI/CD Deployment Strategy (CI always, CD manual)
- Story: 1.1 - Clone and Deploy Template Skeleton

### Expected Result:
All CI checks should pass automatically, demonstrating the pipeline works correctly.

### Acceptance Criteria:
- [x] Test branch created and pushed
- [x] CI workflow triggers on PR creation
- [ ] All CI checks pass (type-check, lint, test, build)
- [ ] Manual deployment tested (optional for this PR)

---

**Note:** This is a test PR to validate Task 6.4. Once CI passes, this PR can be merged or closed." \
  --base "$BASE" \
  --head "$BRANCH")

echo ""
echo "✅ PR created successfully!"
echo "🔗 $PR_URL"
echo ""
echo "⏳ CI checks are now running..."
echo "📊 Check status: gh pr checks or visit the PR URL"
echo ""
echo "🎯 Task 6.4 Verification:"
echo "   1. Wait for CI to complete (2-3 minutes)"
echo "   2. Verify all checks pass (type-check, lint, test, build)"
echo "   3. Optionally test manual deployment to Vercel"
echo "   4. Mark Task 6.4 as complete"
