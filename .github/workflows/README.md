# GitHub Actions Workflows

## test.yml - Continuous Integration (CI)

**Trigger:** Every push and pull request to `main` or `develop`

**What it does:**
1. ✅ Type-check (TypeScript validation)
2. ✅ Lint (ESLint - naming conventions, code quality)
3. ✅ Test with coverage (Vitest - must maintain ≥70%)
4. ✅ Build verification (ensures production build succeeds)
5. ✅ Matrix testing (Node 20.x and 22.x)

**Cost:** FREE (runs in GitHub Actions)

**Result:**
- 🟢 Green check = Code is safe to merge
- 🔴 Red X = Fix issues before merge

---

## Deployment Strategy: Manual (Cost Control)

**CI runs automatically** (free, catches bugs)
**Deployment is MANUAL** (you control costs)

### How to Deploy Manually

#### Option 1: Vercel Dashboard (Easiest)
1. Go to https://vercel.com/gerhard-tractis/aureon-last-mile
2. Click **"Deploy"** button
3. Select branch: `main`
4. Click **"Deploy"**
5. Wait ~2-3 minutes for deployment

#### Option 2: Vercel CLI
```bash
cd apps/frontend
npx vercel --prod
```

#### Option 3: GitHub Integration (One-Time Deploy)
1. Go to Vercel project settings
2. Deployments → Redeploy
3. Select commit/branch → Deploy

---

## Disabling Vercel Auto-Deployments

**To prevent automatic deployments on every push:**

### Method 1: Vercel Dashboard (Recommended)
1. Go to https://vercel.com/gerhard-tractis/aureon-last-mile/settings/git
2. Under **"Git"** section:
   - Uncheck "Production Branch" (or set to `production` instead of `main`)
   - Set "Ignored Build Step" command: `exit 1`
3. Save changes

### Method 2: vercel.json Configuration
Create `apps/frontend/vercel.json`:
```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

### Method 3: Ignored Build Step
In Vercel project settings → Git:
- **Ignored Build Step:** `git diff HEAD^ HEAD --quiet .`
- This makes Vercel skip auto-deploys

---

## Recommended Workflow

### Daily Development
```bash
# 1. Make changes
git add .
git commit -m "feat: add new feature"
git push origin main

# 2. CI runs automatically (free)
# - Tests pass ✅
# - Lint passes ✅
# - Build passes ✅

# 3. No automatic deployment (saves money)
```

### When Ready to Deploy
```bash
# Option A: Vercel Dashboard
# → Go to Vercel → Click "Deploy"

# Option B: CLI
cd apps/frontend
npx vercel --prod

# Option C: Git tag (for versioning)
git tag v1.0.5
git push origin v1.0.5
# → Then deploy via dashboard/CLI
```

---

## Cost Impact

**Before (Auto-deploy):**
- 20 commits/week × 4 weeks = 80 deploys/month 💸💸💸

**After (Manual deploy):**
- Deploy when ready: ~8 deploys/month ✅
- **Savings: ~90% deployment costs**

---

## Future: Upgrade to Tag-Based Deployment

When ready for automated releases:

```yaml
# .github/workflows/deploy-on-tag.yml
on:
  push:
    tags:
      - 'v*.*.*'
```

Then: `git tag v1.1.0 && git push --tags` → Auto-deploys

---

## Questions?

- **"How do I know if CI passed?"** → Check PR status (green ✅ or red ❌)
- **"Can I deploy specific commit?"** → Yes, use Vercel dashboard redeploy
- **"What if CI fails?"** → Fix issues, push again, CI re-runs
- **"Preview deployments on PRs?"** → Disable in Vercel settings to save costs
