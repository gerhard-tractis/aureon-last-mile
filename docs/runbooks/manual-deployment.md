# Manual Deployment Runbook

**Last Updated:** 2026-02-16
**Purpose:** Emergency deployment procedure when GitHub Actions is unavailable

---

## When to Use This Runbook

Use manual deployment when:
- ✅ GitHub Actions is down or unavailable
- ✅ Emergency hotfix required (bypass CI checks)
- ✅ Testing deployment process locally
- ⚠️ **NOT for regular deployments** - Use automated pipeline instead

---

## Prerequisites

### Required Tools
```bash
# Vercel CLI
npm install -g vercel

# Supabase CLI
npm install -g supabase

# Node.js 20.x
node --version  # Should output v20.x.x
```

### Required Credentials
- Vercel account with project access
- Supabase account with project access
- Environment variables (from `.env.local`)

---

## Step-by-Step Manual Deployment

### Step 1: Pre-Deployment Quality Checks

**Run locally before deploying:**
```bash
cd apps/frontend

# Run all quality gates
npm run type-check  # TypeScript validation
npm run lint        # ESLint
npm run test:run    # Unit tests
npm run build       # Verify build succeeds
```

**Success Criteria:**
- ✅ All commands exit with code 0
- ❌ If any fail → Fix issues before proceeding

---

### Step 2: Deploy Supabase Migrations

**Link to production project:**
```bash
cd apps/frontend

# Login to Supabase
supabase login

# Link to production project
supabase link --project-ref <YOUR_PROJECT_REF>
# Find project ref: https://app.supabase.com/project/YOUR_PROJECT_REF
```

**Run migrations:**
```bash
# Push migrations to production
supabase db push

# Verify migrations applied
supabase db diff --schema public
# Should show "No changes detected" after push
```

**Success Criteria:**
- ✅ Migrations applied successfully
- ✅ No errors in migration logs
- ❌ If migration fails → **STOP** - Do NOT deploy frontend

---

### Step 3: Deploy Frontend to Vercel

**Option A: Vercel CLI (Recommended)**
```bash
cd apps/frontend

# Login to Vercel
vercel login

# Deploy to production
vercel --prod

# Confirm deployment URL
# Output: https://aureon-last-mile.vercel.app
```

**Option B: Vercel Dashboard**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select project: `aureon-last-mile`
3. Click **Deployments** tab
4. Click **Deploy** button → Select `main` branch
5. Wait for deployment to complete (~5 minutes)

**Success Criteria:**
- ✅ Deployment succeeds (green checkmark)
- ✅ Production URL accessible: https://aureon-last-mile.vercel.app
- ✅ No build errors in logs

---

### Step 4: Post-Deployment Verification

**Smoke Tests:**
```bash
# 1. Check health endpoint
curl https://aureon-last-mile.vercel.app/api/health
# Expected: {"status": "ok"}

# 2. Verify authentication works
# Open https://aureon-last-mile.vercel.app/login
# Test login with admin credentials

# 3. Check Sentry for errors
# Open https://sentry.io/organizations/tractis/projects/aureon-last-mile/
# Verify no new errors in last 5 minutes
```

**Rollback if any smoke test fails:**
- See [Rollback Production](rollback-production.md)

---

## Rollback Procedure

**If deployment fails or smoke tests fail:**

### Vercel Rollback (CLI)
```bash
# List recent deployments
vercel ls

# Rollback to previous deployment
vercel rollback
# Follow prompts to select previous deployment
```

### Vercel Rollback (Dashboard)
1. Go to Vercel Dashboard → Deployments
2. Find previous successful deployment
3. Click **⋮** menu → **Promote to Production**

### Supabase Migrations Rollback
```bash
# NOT RECOMMENDED - Migrations are forward-only
# If migration breaks production:
# 1. Write a new migration to revert changes
# 2. Apply new migration via supabase db push
```

**Full guide:** [Rollback Production Runbook](rollback-production.md)

---

## Common Issues

### Issue: `vercel: command not found`
**Solution:**
```bash
npm install -g vercel
vercel --version  # Verify installation
```

---

### Issue: `supabase: command not found`
**Solution:**
```bash
npm install -g supabase
supabase --version  # Verify installation
```

---

### Issue: Vercel deployment fails with "Build failed"
**Solution:**
1. Check build logs in Vercel dashboard
2. Verify environment variables are set (Settings → Environment Variables)
3. Test build locally: `npm run build`
4. Check for missing dependencies in `package.json`

---

### Issue: Supabase migrations fail with "Permission denied"
**Solution:**
1. Verify you're linked to correct project: `supabase status`
2. Check database password is correct
3. Verify migrations syntax: `supabase db lint`

---

## Emergency Contacts

**DevOps Team:**
- Email: devops@tractis.com
- Slack: #aureon-devops

**Escalation:**
- On-call engineer: Check PagerDuty rotation

---

## Post-Manual Deployment

**Document the incident:**
1. Create issue: "Manual deployment - [DATE] - [REASON]"
2. Include: Why GitHub Actions unavailable, steps taken, any issues encountered
3. Post-mortem: Update runbook if process failed

**Restore automated deployments:**
- Once GitHub Actions is available, verify CI/CD pipeline works
- Run test deployment via PR to verify automation

---

## Related Runbooks

- [Rollback Production](rollback-production.md)
- [Debug Failed Deployment](debug-failed-deployment.md)
