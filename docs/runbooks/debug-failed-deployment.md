# Debug Failed Deployment Runbook

**Last Updated:** 2026-02-16
**Purpose:** Systematic troubleshooting guide for deployment failures

---

## Quick Diagnosis

### Identify Failure Point

```
Deployment Failed?
    ├─ CI Workflow Failed? → See Section 1
    ├─ Supabase Migration Failed? → See Section 2
    ├─ Vercel Deployment Failed? → See Section 3
    └─ Post-Deployment Issues? → See Section 4
```

---

## Section 1: CI Workflow Failures

**Location:** `.github/workflows/ci.yml`
**View Logs:** GitHub → Actions tab → Failed workflow run

### 1.1 Test Job Failed

**Check logs for:**
```
FAIL src/component.test.tsx
  ● Test suite failed to run
```

**Debugging steps:**
```bash
# Run tests locally
cd apps/frontend
npm run test:run

# Run specific test file
npm run test -- src/component.test.tsx

# Check for flaky tests
npm run test:run -- --reporter=verbose
```

**Common causes:**
- Flaky tests (timing issues)
- Missing test dependencies
- Environment variable not set
- Test database connection failure

**Solution:**
```bash
# Fix test, then push
git add .
git commit -m "fix: Resolve failing test"
git push
```

---

### 1.2 Type Check Job Failed

**Check logs for:**
```
error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
```

**Debugging steps:**
```bash
# Run type check locally
npm run type-check

# Check specific file
npx tsc --noEmit src/problematic-file.ts
```

**Common causes:**
- TypeScript version mismatch
- Missing type definitions
- Invalid type annotations
- Strict mode violations

**Solution:**
```bash
# Fix TypeScript errors, then push
npm run type-check  # Verify locally
git add .
git commit -m "fix: Resolve TypeScript errors"
git push
```

---

### 1.3 Lint Job Failed

**Check logs for:**
```
error  'variableName' is assigned a value but never used  @typescript-eslint/no-unused-vars
```

**Debugging steps:**
```bash
# Run lint locally
npm run lint

# Auto-fix lint errors
npm run lint -- --fix
```

**Common causes:**
- Code style violations
- Unused variables
- Missing imports
- ESLint rule violations

**Solution:**
```bash
# Fix lint errors (or auto-fix)
npm run lint -- --fix
git add .
git commit -m "fix: Resolve linting errors"
git push
```

---

### 1.4 Build Job Failed

**Check logs for:**
```
Error: Build failed
Module not found: Can't resolve './component'
```

**Debugging steps:**
```bash
# Build locally
npm run build

# Check for missing files
ls -la src/components/

# Check for circular dependencies
npm run build -- --debug
```

**Common causes:**
- Missing imports
- Circular dependencies
- Environment variables not set
- Build optimization failures

**Solution:**
```bash
# Fix build issues
npm run build  # Verify locally

# Add missing env vars to GitHub Secrets
# GitHub → Settings → Secrets → Add:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY

git add .
git commit -m "fix: Resolve build errors"
git push
```

---

## Section 2: Supabase Migration Failures

**Location:** `.github/workflows/deploy.yml` → `deploy-supabase` job
**View Logs:** GitHub Actions → Deploy workflow → deploy-supabase job

### 2.1 Migration Syntax Error

**Check logs for:**
```
ERROR: syntax error at or near "CREAT"
```

**Debugging steps:**
```bash
cd apps/frontend

# Lint migrations
supabase db lint

# Test migration locally
supabase db reset  # Resets local DB
supabase db push   # Applies migrations
```

**Common causes:**
- SQL syntax error
- Missing semicolon
- Invalid PostgreSQL syntax

**Solution:**
```bash
# Fix migration file
# Edit: apps/frontend/supabase/migrations/XXXXXXX_migration.sql

# Test locally
supabase db reset && supabase db push

# Push fix
git add supabase/migrations/
git commit -m "fix: Correct SQL syntax in migration"
git push
```

---

### 2.2 Migration Violates Constraint

**Check logs for:**
```
ERROR: duplicate key value violates unique constraint "users_email_key"
```

**Debugging steps:**
```bash
# Check existing data
supabase db logs

# Inspect production database
# Supabase Dashboard → Database → SQL Editor
SELECT * FROM users WHERE email = 'duplicate@example.com';
```

**Common causes:**
- Migration assumes clean data
- Unique constraint violation
- Foreign key constraint violation
- Data already exists

**Solution:**
```sql
-- Update migration to handle existing data
-- Before:
INSERT INTO users (email) VALUES ('admin@example.com');

-- After:
INSERT INTO users (email)
VALUES ('admin@example.com')
ON CONFLICT (email) DO NOTHING;
```

---

### 2.3 Permission Denied

**Check logs for:**
```
ERROR: permission denied for table users
```

**Debugging steps:**
```bash
# Check Supabase access token
echo $SUPABASE_ACCESS_TOKEN

# Verify project link
supabase status
```

**Common causes:**
- Invalid SUPABASE_ACCESS_TOKEN
- Incorrect SUPABASE_PROJECT_REF
- Expired credentials

**Solution:**
```bash
# Regenerate access token
# Supabase Dashboard → Account → Access Tokens → Create new token

# Update GitHub Secret
# GitHub → Settings → Secrets → Update:
# SUPABASE_ACCESS_TOKEN = <new_token>

# Retry deployment
# Merge to main again or manually trigger workflow
```

---

## Section 3: Vercel Deployment Failures

**Location:** `.github/workflows/deploy.yml` → `deploy-vercel` job
**View Logs:** GitHub Actions → Deploy workflow → deploy-vercel job

### 3.1 Build Failed on Vercel

**Check logs for:**
```
Error: Command "npm run build" exited with 1
```

**Debugging steps:**
```bash
# Build locally with Vercel environment
npm run build

# Check Vercel environment variables
# Vercel Dashboard → Settings → Environment Variables

# Verify all required vars are set:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
```

**Common causes:**
- Missing environment variables
- Build command failed (see Section 1.4)
- Node version mismatch

**Solution:**
```bash
# Add missing environment variables in Vercel
# Vercel Dashboard → Settings → Environment Variables → Add:
# NEXT_PUBLIC_SUPABASE_URL = https://xxx.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJxxx...

# Redeploy
vercel --prod
```

---

### 3.2 Deployment Timeout

**Check logs for:**
```
Error: Deployment timed out after 15 minutes
```

**Debugging steps:**
```bash
# Check build size
npm run build
du -sh .next/

# Check for large dependencies
npm ls --depth=0 | grep MB
```

**Common causes:**
- Build too slow (>15 minutes)
- Large dependencies
- Infinite loop in build script

**Solution:**
```bash
# Optimize build
# 1. Enable SWC minification (faster than Terser)
# next.config.js:
module.exports = {
  swcMinify: true
}

# 2. Remove unused dependencies
npm prune

# 3. Increase Vercel timeout (if on paid plan)
# Vercel Dashboard → Settings → General → Build & Development Settings
```

---

### 3.3 Rollback Failed

**Check logs for:**
```
Error: No previous deployment found to rollback to
```

**Debugging steps:**
```bash
# List deployments
vercel ls

# Check if previous deployment exists
vercel inspect <deployment_url>
```

**Common causes:**
- First deployment (no previous version)
- Previous deployment already deleted
- Vercel API error

**Solution:**
```bash
# Manual fix deployment instead of rollback
# 1. Revert commit locally
git revert HEAD

# 2. Push fix
git push

# 3. Let CI/CD deploy fixed version
```

---

## Section 4: Post-Deployment Issues

**Deployment succeeded but production is broken**

### 4.1 500 Internal Server Error

**Symptoms:** Production returns 500 errors

**Debugging steps:**
```bash
# Check Sentry errors
open https://sentry.io/organizations/tractis/projects/aureon-last-mile/

# Check Vercel function logs
vercel logs --prod --limit 100

# Check health endpoint
curl https://aureon-last-mile.vercel.app/api/health
```

**Common causes:**
- Runtime error in API route
- Missing environment variable
- Database connection failure

**Solution:**
```bash
# Quick fix: Rollback
vercel rollback --yes

# Permanent fix: Fix code + redeploy
# See Section 1 for debugging code issues
```

---

### 4.2 Database Connection Failure

**Symptoms:** "Connection refused", "timeout" errors

**Debugging steps:**
```bash
# Test database connection
curl https://aureon-last-mile.vercel.app/api/health

# Check Supabase status
# Supabase Dashboard → Project → Health

# Verify environment variables
# Vercel Dashboard → Settings → Environment Variables
```

**Common causes:**
- NEXT_PUBLIC_SUPABASE_URL incorrect
- NEXT_PUBLIC_SUPABASE_ANON_KEY expired
- Supabase project paused/deleted

**Solution:**
```bash
# Update environment variables in Vercel
# Vercel Dashboard → Settings → Environment Variables → Edit

# Redeploy to pick up new env vars
vercel --prod
```

---

## Debugging Checklist

- [ ] Identify which step failed (CI, Supabase, Vercel, Post-deploy)
- [ ] Check workflow logs in GitHub Actions
- [ ] Reproduce issue locally
- [ ] Check environment variables (GitHub Secrets, Vercel settings)
- [ ] Check Sentry for runtime errors
- [ ] Test deployment in staging first (if available)
- [ ] Document fix in GitHub issue
- [ ] Update runbook if new failure mode discovered

---

## Useful Commands

```bash
# Local testing
npm run test:run        # Run all tests
npm run type-check      # TypeScript check
npm run lint            # ESLint
npm run build           # Next.js build

# Supabase debugging
supabase db lint        # Check migration syntax
supabase db reset       # Reset local database
supabase db push        # Apply migrations
supabase db logs        # View database logs

# Vercel debugging
vercel logs --prod      # Production logs
vercel ls               # List deployments
vercel inspect <url>    # Inspect deployment
vercel rollback         # Rollback to previous
```

---

## Emergency Contacts

**DevOps Team:**
- Slack: #aureon-devops
- Email: devops@tractis.com

**On-Call Engineer:**
- Check PagerDuty rotation

---

## Related Runbooks

- [Rollback Production](rollback-production.md)
- [Manual Deployment](manual-deployment.md)
- [CI/CD Architecture](../ci-cd-architecture.md)
