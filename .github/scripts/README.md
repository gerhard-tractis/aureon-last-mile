# GitHub Automation Scripts

Scripts for automating GitHub repository configuration tasks.

## Prerequisites

**GitHub CLI Authentication:**
```bash
gh auth login
```

Follow the prompts:
- Choose: GitHub.com
- Protocol: HTTPS
- Authenticate: Browser or Token

## Scripts

### 1. Configure Branch Protection (Task 6.3)

**Purpose:** Set up branch protection rules for the `main` branch.

**Usage:**
```bash
# Option 1: Bash (Git Bash on Windows)
bash .github/scripts/configure-branch-protection.sh

# Option 2: Direct gh CLI
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/gerhard-tractis/aureon-last-mile/branches/main/protection" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=test (20.x)" \
  -f "required_status_checks[contexts][]=test (22.x)" \
  -f "enforce_admins=false" \
  -f "allow_force_pushes=false"

# Option 3: GitHub Web UI (Manual)
# → Go to: https://github.com/gerhard-tractis/aureon-last-mile/settings/branches
# → Click "Add rule" for branch "main"
# → Enable: "Require status checks to pass before merging"
# → Select: test (20.x), test (22.x)
# → Enable: "Require branches to be up to date before merging"
# → Save changes
```

**Protection Rules Applied:**
- ✅ Require CI checks to pass before merging
- ✅ Required checks: `test (20.x)`, `test (22.x)`
- ✅ Block force pushes to main
- ✅ Block branch deletion
- ⚠️  Code review NOT required (single developer MVP)

---

### 2. Create CI Test PR (Task 6.4)

**Purpose:** Create a test PR to verify the CI pipeline works correctly.

**Usage:**
```bash
# Option 1: Bash (Git Bash on Windows)
bash .github/scripts/create-ci-test-pr.sh

# Option 2: Direct gh CLI
gh pr create \
  --title "test: CI Pipeline Verification (Task 6.4)" \
  --body "CI pipeline test..." \
  --base main \
  --head test/ci-pipeline-verification

# Option 3: GitHub Web UI (Manual)
# → Go to: https://github.com/gerhard-tractis/aureon-last-mile/pull/new/test/ci-pipeline-verification
# → Fill in title and description
# → Click "Create pull request"
```

**Expected Behavior:**
- CI workflow (`.github/workflows/test.yml`) triggers automatically
- All checks should pass:
  - ✅ Type-check (TypeScript)
  - ✅ Lint (ESLint)
  - ✅ Test with coverage (≥70%)
  - ✅ Build verification
  - ✅ Matrix: Node 20.x and 22.x

**Verification:**
```bash
# Check PR status
gh pr checks

# View PR in browser
gh pr view --web
```

---

## Troubleshooting

### "gh: command not found"
GitHub CLI not installed or not in PATH.

**Fix:**
```bash
# Windows (winget)
winget install --id GitHub.cli

# macOS (Homebrew)
brew install gh

# Linux (apt)
sudo apt install gh
```

Then restart your terminal.

---

### "You are not logged into any GitHub hosts"
GitHub CLI not authenticated.

**Fix:**
```bash
gh auth login
```

---

### "Resource not accessible by personal access token"
Token lacks required permissions.

**Fix:**
1. Generate new token: https://github.com/settings/tokens/new
2. Required scopes: `repo`, `workflow`, `admin:repo_hook`
3. Run: `gh auth login` → Choose "Paste an authentication token"

---

## Related Documentation

- [CI/CD Strategy (ADR-005)](../../_bmad-output/architectural-decisions/ADR-005-cicd-deployment-strategy.md)
- [CI/CD Workflow Guide](../workflows/README.md)
- [Story 1.1 - Task 6](../../_bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md#task-6-set-up-cicd-pipeline-ac-9)
