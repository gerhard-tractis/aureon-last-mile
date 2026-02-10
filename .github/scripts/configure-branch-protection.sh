#!/bin/bash
# Task 6.3: Configure GitHub Branch Protection Rules
# This script configures branch protection for the main branch

set -e

REPO_OWNER="gerhard-tractis"
REPO_NAME="aureon-last-mile"
BRANCH="main"

echo "🔒 Configuring branch protection for '$BRANCH' branch..."
echo ""

# Check if gh CLI is authenticated
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ GitHub CLI not authenticated. Please run:"
  echo "   gh auth login"
  echo ""
  exit 1
fi

echo "✅ GitHub CLI authenticated"
echo ""

# Configure branch protection rules
echo "📋 Applying branch protection rules..."
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/${REPO_OWNER}/${REPO_NAME}/branches/${BRANCH}/protection" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=test (20.x)" \
  -f "required_status_checks[contexts][]=test (22.x)" \
  -f "enforce_admins=false" \
  -f "required_pull_request_reviews=null" \
  -f "restrictions=null" \
  -f "required_linear_history=false" \
  -f "allow_force_pushes=false" \
  -f "allow_deletions=false" \
  -f "block_creations=false" \
  -f "required_conversation_resolution=false"

echo ""
echo "✅ Branch protection configured successfully!"
echo ""
echo "📋 Protection Rules Applied:"
echo "   - ✅ Require CI checks to pass before merging"
echo "   - ✅ Required checks: test (20.x), test (22.x)"
echo "   - ✅ Block force pushes"
echo "   - ✅ Block branch deletion"
echo "   - ⚠️  Code review NOT required (single developer MVP)"
echo ""
echo "🔍 View settings: https://github.com/${REPO_OWNER}/${REPO_NAME}/settings/branches"
