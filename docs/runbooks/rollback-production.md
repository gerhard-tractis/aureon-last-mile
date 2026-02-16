# Rollback Production Runbook

**Last Updated:** 2026-02-16
**Purpose:** Restore production to previous working state after failed deployment

---

## When to Use This Runbook

Rollback production when:
- ✅ Deployment introduced critical bugs
- ✅ Production is down or unstable
- ✅ Database migration caused data corruption
- ✅ Performance degraded significantly
- ⚠️ **Within 1 hour of deployment** - Easiest window for rollback

---

## Severity Levels

### 🔴 P0 - Critical (Immediate Rollback Required)
- Production is down (5xx errors)
- Data loss or corruption
- Security vulnerability introduced
- **Action:** Rollback immediately, notify team after

### 🟡 P1 - High (Rollback Within 15 Minutes)
- Major feature broken
- Performance degraded >50%
- Authentication issues
- **Action:** Assess impact, rollback if fix not available

### 🟢 P2 - Medium (Consider Rollback)
- Minor feature broken
- UI rendering issues
- Non-critical error logs
- **Action:** Evaluate if forward fix is faster than rollback

---

## Quick Rollback (Automated)

### Vercel Rollback (Frontend)

**Via GitHub Actions (Automatic):**
- Deployment failures trigger automatic rollback
- Check workflow logs: `deploy.yml` → "Rollback on failure" step

**Via Vercel CLI:**
```bash
# 1. List recent deployments
vercel ls

# 2. Rollback to previous deployment
vercel rollback --yes

# 3. Verify rollback succeeded
curl https://aureon-last-mile.vercel.app/api/health
```

**Via Vercel Dashboard:**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select project: `aureon-last-mile`
3. Click **Deployments** tab
4. Find previous successful deployment (green checkmark)
5. Click **⋮** menu → **Promote to Production**
6. Confirm rollback

**Success Criteria:**
- ✅ Previous deployment is now production
- ✅ Health check passes
- ✅ No new errors in Sentry

---

## Database Rollback (Supabase Migrations)

⚠️ **WARNING:** Database rollback is complex and risky

### Option 1: Forward Fix (Recommended)
**Write a new migration to undo changes:**
```bash
cd apps/frontend

# Create revert migration
supabase migration new revert_broken_migration

# Edit migration file to undo changes
# Example: DROP COLUMN if migration added column
# Example: ALTER TABLE if migration modified schema

# Apply revert migration
supabase db push
```

**Example Revert Migration:**
```sql
-- Revert: apps/frontend/supabase/migrations/20260216_add_user_column.sql
-- Original migration: ALTER TABLE users ADD COLUMN phone_number TEXT;

-- Revert migration:
ALTER TABLE users DROP COLUMN IF EXISTS phone_number;
```

---

### Option 2: Restore from Backup (Last Resort)

⚠️ **DANGER:** This will lose all data since backup was taken

**Prerequisites:**
- Database backup exists (Supabase automatic backups)
- Approval from engineering lead

**Steps:**
1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Select project → **Database** → **Backups**
3. Find backup before failed migration
4. Click **Restore** → Confirm data loss warning
5. Wait for restore to complete (~5-15 minutes depending on DB size)

**Post-Restore:**
```bash
# Verify database schema
supabase db diff --schema public

# Re-run migrations up to working state
# (Skip the broken migration)
supabase db push
```

---

## Full Rollback Procedure (Both Frontend + Database)

### Step 1: Assess Impact

**Questions to answer:**
- What broke? (frontend, backend, database, all)
- How many users affected? (check Sentry user count)
- Can we forward-fix faster than rollback? (if yes, do that instead)

**Gather evidence:**
```bash
# Check Sentry errors
open https://sentry.io/organizations/tractis/projects/aureon-last-mile/

# Check Vercel deployment logs
vercel logs --prod

# Check Supabase logs
supabase db logs --limit 100
```

---

### Step 2: Communicate

**Notify stakeholders BEFORE rolling back:**
```
TO: #aureon-incidents (Slack)
SUBJECT: Production Rollback - [TIMESTAMP]

Severity: [P0/P1/P2]
Issue: [Brief description]
Impact: [User-facing symptoms]
Action: Rolling back to deployment [DEPLOYMENT_ID]
ETA: [Time to complete rollback]

Will update when rollback complete.
```

---

### Step 3: Execute Rollback

**Order matters - Rollback frontend first, then database:**

#### 3a. Rollback Frontend (Vercel)
```bash
# Rollback to previous deployment
vercel rollback --yes

# Verify rollback
curl https://aureon-last-mile.vercel.app/api/health
```

#### 3b. Rollback Database (Supabase) - If Needed
```bash
# Option 1: Forward fix (create revert migration)
cd apps/frontend
supabase migration new revert_[migration_name]
# Edit migration file, then:
supabase db push

# Option 2: Restore from backup (LAST RESORT)
# See "Database Rollback" section above
```

---

### Step 4: Verify Rollback

**Run smoke tests:**
```bash
# 1. Health check
curl https://aureon-last-mile.vercel.app/api/health

# 2. Login test
open https://aureon-last-mile.vercel.app/login
# Verify authentication works

# 3. Database connectivity
# Try creating/reading data via app UI

# 4. Check Sentry for new errors
open https://sentry.io/organizations/tractis/projects/aureon-last-mile/
# Should see error rate drop to normal
```

---

### Step 5: Post-Rollback Communication

**Update stakeholders:**
```
TO: #aureon-incidents (Slack)
SUBJECT: Rollback Complete - [TIMESTAMP]

Rollback Status: ✅ Complete
Production Status: ✅ Stable
Verification: All smoke tests passing

Next Steps:
- Root cause analysis: [JIRA ticket]
- Fix development: [Timeline]
- Retry deployment: [When safe]
```

---

## Post-Rollback Actions

### Immediate (Within 1 hour)
- [ ] Document what broke in GitHub issue
- [ ] Create Sentry issue with error logs
- [ ] Update sprint-status.yaml if story status changed

### Short-term (Within 24 hours)
- [ ] Conduct root cause analysis (5 Whys)
- [ ] Create fix PR with tests covering the failure
- [ ] Re-test in staging environment

### Long-term (Within 1 week)
- [ ] Post-mortem document
- [ ] Update CI/CD to catch this failure class
- [ ] Share learnings with team

---

## Common Rollback Scenarios

### Scenario 1: Frontend Build Error
**Symptoms:** 500 errors, blank page, "Application error"
**Rollback:** Vercel only
**Command:** `vercel rollback --yes`
**Time:** ~2 minutes

---

### Scenario 2: Database Migration Breaks Schema
**Symptoms:** 500 errors, "relation does not exist", "column not found"
**Rollback:** Database first, then verify frontend works
**Command:** Create revert migration + `supabase db push`
**Time:** ~10 minutes

---

### Scenario 3: Authentication Broken
**Symptoms:** Users can't log in, "Unauthorized" errors
**Rollback:** Check Supabase Auth settings, may need both rollbacks
**Command:** Vercel rollback + check Auth settings in Supabase dashboard
**Time:** ~5 minutes

---

### Scenario 4: Performance Degradation
**Symptoms:** Slow page loads, timeout errors, high CPU
**Rollback:** Vercel rollback if frontend change, DB rollback if migration added indexes/constraints
**Command:** `vercel rollback --yes` or revert migration
**Time:** ~5 minutes

---

## Rollback Checklist

- [ ] Impact assessed (severity, affected users)
- [ ] Stakeholders notified (#aureon-incidents)
- [ ] Evidence gathered (Sentry, Vercel logs, Supabase logs)
- [ ] Rollback decision approved (P0: auto-approve, P1: lead approval)
- [ ] Frontend rolled back (if needed)
- [ ] Database rolled back (if needed)
- [ ] Smoke tests passing
- [ ] Stakeholders updated (rollback complete)
- [ ] Incident documented (GitHub issue)
- [ ] Post-mortem scheduled

---

## Emergency Contacts

**Immediate Response:**
- On-call engineer: Check PagerDuty rotation
- Slack: #aureon-incidents

**Escalation:**
- Engineering Lead: [Contact info]
- CTO: [Contact info]

---

## Related Runbooks

- [Manual Deployment](manual-deployment.md)
- [Debug Failed Deployment](debug-failed-deployment.md)
