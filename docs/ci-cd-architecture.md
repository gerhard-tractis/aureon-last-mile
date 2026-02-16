# CI/CD Architecture

**Last Updated:** 2026-02-16
**Story:** 1.7 - Configure CI/CD Pipeline (GitHub Actions)

---

## Overview

Aureon Last Mile uses **GitHub Actions** for automated quality gates and production deployments. The CI/CD pipeline ensures code quality through parallel testing and enforces deployment safety through sequential migration-first deployments.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     CI/CD WORKFLOW                           │
└─────────────────────────────────────────────────────────────┘

PUSH/PR → CI Workflow (.github/workflows/ci.yml)
           ├─ test (10min)         ┐
           ├─ type-check (5min)    │ Parallel
           ├─ lint (5min)          │ (4 jobs)
           └─ build (10min)        ┘
              │
              ├─ ALL PASS → ✅ Merge allowed
              └─ ANY FAIL → ❌ Merge blocked

MERGE → Deploy Workflow (.github/workflows/deploy.yml)
         ├─ deploy-supabase (5min)    Sequential
         │   └─ Run migrations         (migrations first)
         └─ deploy-vercel (15min)
             └─ Deploy frontend
                │
                ├─ SUCCESS → ✅ Production updated
                └─ FAILURE → 🔄 Rollback to previous version
```

---

## CI Workflow (Quality Gates)

### Trigger Events
- **Push:** All branches (feature branches, main)
- **Pull Request:** All branches

### Jobs (Run in Parallel)

#### 1. **Test** (10 minutes)
```yaml
- Checkout code
- Setup Node.js 20.x
- Install dependencies (npm ci)
- Run tests (npm run test:run)
```

**Validates:** Unit tests pass, no regressions

---

#### 2. **Type Check** (5 minutes)
```yaml
- Checkout code
- Setup Node.js 20.x
- Install dependencies
- Run TypeScript compiler (npm run type-check)
```

**Validates:** No TypeScript errors, type safety enforced

---

#### 3. **Lint** (5 minutes)
```yaml
- Checkout code
- Setup Node.js 20.x
- Install dependencies
- Run ESLint (npm run lint)
```

**Validates:** Code style consistency, no linting errors

---

#### 4. **Build** (10 minutes)
```yaml
- Checkout code
- Setup Node.js 20.x
- Install dependencies
- Build Next.js app (npm run build)
```

**Validates:** App builds successfully for production

---

### Success Criteria

- ✅ All 4 jobs must pass
- ✅ Workflow completes in <10 minutes (parallel execution)
- ❌ If any job fails → PR blocked from merging

---

## Deploy Workflow (Production Deployment)

### Trigger Events
- **Push to main:** Only runs on successful merge to main branch

### Jobs (Run Sequentially)

#### 1. **Deploy Supabase Migrations** (5 minutes)
```yaml
- Checkout code
- Setup Supabase CLI
- Link project (SUPABASE_PROJECT_REF)
- Run migrations (supabase db push)
```

**Why First:** Ensures database schema is updated before app deployment

---

#### 2. **Deploy Vercel** (15 minutes)
**Depends on:** deploy-supabase ✅

```yaml
- Checkout code
- Deploy to Vercel (amondnet/vercel-action@v25)
  - Production deployment (--prod)
  - Auto-assigned URL: aureon-last-mile.vercel.app
- Rollback on failure
  - If deployment fails → vercel rollback --yes
```

**Why Second:** App code depends on updated database schema

---

### Rollback Strategy

**Automatic Rollback on Deploy Failure:**
```yaml
- name: Rollback on failure
  if: failure()
  run: vercel rollback --yes --token=${{ secrets.VERCEL_TOKEN }}
```

**Manual Rollback:**
See [Rollback Production Runbook](runbooks/rollback-production.md)

---

## Branch Protection Rules

**Branch:** `main`

### Required Checks
- ✅ test
- ✅ type-check
- ✅ lint
- ✅ build

### Additional Protections
- ✅ Require PR reviews (1 approval)
- ✅ Dismiss stale reviews on new commits
- ✅ Require branches up to date before merge
- ✅ Require linear history (no merge commits)
- ❌ No force pushes (prevent history rewriting)
- ⚠️ Admins can bypass (emergency hotfixes only)

---

## GitHub Actions Secrets

### Vercel Secrets
```
VERCEL_TOKEN           # From Vercel → Settings → Tokens
VERCEL_ORG_ID          # From Vercel project settings
VERCEL_PROJECT_ID      # From Vercel project settings
```

### Supabase Secrets
```
SUPABASE_ACCESS_TOKEN  # From Supabase → Account → Access Tokens
SUPABASE_PROJECT_REF   # From Supabase project URL
SUPABASE_DB_PASSWORD   # From Supabase project settings
```

### Environment Variables (Public)
```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anonymous key
```

---

## Preview Environments (PR Deployments)

**Vercel GitHub Integration (Automatic):**
- Every PR push → Auto-deploy to preview URL
- Preview URL format: `pr-{number}-aureon-last-mile.vercel.app`
- Cleanup: Auto-delete when PR is closed

**Supabase Branch Databases:**
- Option 1: Shared staging database (simpler, lower cost)
- Option 2: Per-PR branch databases (isolated, higher cost)
- Current: Shared staging database

---

## Concurrency Control

**Deploy Workflow:**
```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false  # Queue deployments
```

**Why:** Prevents race conditions, ensures deployments complete in order

---

## Performance Metrics

### CI Workflow
- **Total time:** ~10 minutes (parallel jobs)
- **Resource usage:** 4 concurrent jobs = 40 GitHub Actions minutes
- **Trigger frequency:** Every push/PR (~50-100 runs/month)

### Deploy Workflow
- **Total time:** ~20 minutes (sequential jobs)
- **Resource usage:** 20 GitHub Actions minutes
- **Trigger frequency:** Every merge to main (~10-20 deploys/month)

---

## Troubleshooting

### Common Issues

**CI fails on fresh PR:**
- Check that all dependencies are installed (`npm ci`)
- Verify tests pass locally (`npm run test:run`)
- Check TypeScript errors (`npm run type-check`)

**Deploy fails on migration step:**
- See [Debug Failed Deployment](runbooks/debug-failed-deployment.md)
- Check Supabase migrations in `apps/frontend/supabase/migrations/`
- Verify secrets are correct (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD)

**Deploy fails on Vercel step:**
- Check Vercel build logs in dashboard
- Verify environment variables are set (NEXT_PUBLIC_*)
- Use rollback procedure: [Rollback Production](runbooks/rollback-production.md)

---

## Future Improvements

- [ ] Add E2E tests to CI workflow (Playwright)
- [ ] Implement canary deployments (gradual rollout)
- [ ] Add deployment notifications (Slack/email)
- [ ] Monitor CI/CD performance (build time tracking)
- [ ] Add security scanning (SAST/dependency scanning)

---

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel GitHub Integration](https://vercel.com/docs/deployments/git/vercel-for-github)
- [Supabase CLI - GitHub Actions](https://supabase.com/docs/guides/cli/github-actions)
