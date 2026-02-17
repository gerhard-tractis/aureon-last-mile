# Runbook: Sentry High Error Rate Alert

**Alert Type:** High Error Rate
**Severity:** High
**SLA:** Investigate within 15 minutes, resolve within 2 hours

---

## Alert Trigger

**Condition:** Error count >5% of total events in 5-minute window

**Example Alert:**
```
[Sentry Alert] High Error Rate Detected
Project: aureon-last-mile
Error Rate: 8.2% (410 errors / 5,000 events)
Time Window: 2026-02-17 13:40:00 - 13:45:00
```

---

## Immediate Actions (First 5 Minutes)

### 1. Assess Impact

Open Sentry dashboard: [sentry.io/aureon-last-mile](https://sentry.io)

**Questions to answer:**
- How many users affected? (Check "Affected Users" count)
- What's the error message/type?
- Is this a new error or spike in existing error?
- Which environment? (production/staging)

### 2. Check Recent Deployments

```bash
# Check recent Vercel deployments
gh api repos/tractis/aureon-last-mile/deployments \
  --jq '.[] | select(.environment=="production") | {created_at, sha, creator:.creator.login}' \
  | head -5
```

**If recent deployment (<30 min):**
- Check deployment logs for errors
- Consider rollback if correlation is strong

### 3. Quick Triage

**In Sentry:**
1. Click on top error in "Issues" tab
2. Review stack trace - identify failing component/function
3. Check breadcrumbs - what user actions led to error?
4. Review user context - operator_id, role, affected users

---

## Investigation Steps

### Step 1: Identify Error Pattern

**Questions:**
- Is error isolated to specific operator? (Check user.operator_id tag)
- Is error isolated to specific role? (Check user.role tag)
- Is error isolated to specific feature/route? (Check breadcrumbs)
- Is error environment-specific? (Check environment tag)

**Sentry Filters:**
```
# Filter by operator
user.operator_id:op-123

# Filter by role
user.role:driver

# Filter by environment
environment:production
```

### Step 2: Check Dependencies

**Database:**
```bash
# Check Supabase status
curl https://app.aureon.com/api/health
```

Expected response: `{"status": "healthy"}`

**External APIs:**
- Check third-party service status pages
- Review API logs in Vercel dashboard

### Step 3: Review Code Changes

**Recent commits:**
```bash
git log --oneline -10
```

**Changed files related to error:**
```bash
# If error is in UserForm.tsx
git log --oneline --all -- src/components/admin/UserForm.tsx
```

### Step 4: Reproduce Locally

1. Check out commit hash from Sentry event
2. Set up local environment
3. Follow breadcrumbs to reproduce user actions
4. Use Sentry event data (request payload, user context)

---

## Resolution Strategies

### Strategy 1: Quick Fix (< 1 hour)

**When:** Clear bug, simple fix available

1. Create hotfix branch: `git checkout -b hotfix/high-error-rate-issue-123`
2. Implement fix
3. Write test to prevent regression
4. Deploy to staging, verify fix
5. Deploy to production
6. Monitor Sentry for 15 minutes

### Strategy 2: Rollback (< 15 minutes)

**When:** Recent deployment caused error spike, no quick fix

```bash
# Via Vercel CLI
vercel rollback [deployment-url]

# Or via Vercel dashboard
# Deployments → [Select previous stable deployment] → Promote to Production
```

**After rollback:**
1. Verify error rate drops in Sentry
2. Investigate root cause offline
3. Prepare proper fix for next deployment

### Strategy 3: Feature Flag (< 30 minutes)

**When:** Error isolated to specific feature

1. Add feature flag to disable problematic feature
2. Deploy flag change
3. Disable feature for affected users
4. Fix issue offline
5. Re-enable feature after fix

### Strategy 4: Mitigation (< 2 hours)

**When:** No immediate fix, need to reduce impact

**Options:**
- Add error boundary to contain failure
- Add try-catch with fallback UI
- Add validation to prevent bad data
- Add rate limiting to prevent abuse

---

## Communication

### Internal

**Slack #incidents:**
```
🚨 High error rate detected in production
Severity: High
Impact: [X] users affected
Error: [Brief description]
Status: Investigating
ETA: [15 min / 1 hour / 2 hours]
Incident Commander: @[your-name]
```

**Updates every 30 minutes until resolved**

### External (If customer-facing)

**Status page update** (if >100 users affected):
```
We're investigating reports of errors in [feature name].
Our team is working on a fix.
Affected users: [~X%]
ETA: [time]
```

---

## Post-Incident

### 1. Verify Resolution

- Monitor Sentry for 1 hour after fix
- Check error rate returns to baseline (<1%)
- Verify no new related errors

### 2. Document Root Cause

**Create postmortem document:**
- What happened?
- Root cause
- Why wasn't it caught in testing?
- What's the permanent fix?
- How do we prevent similar issues?

### 3. Preventive Actions

- Add test coverage for affected code path
- Update monitoring alerts if needed
- Update runbook if process can be improved
- Share learnings with team

---

## Escalation

**Escalate if:**
- Error rate >10% and increasing
- Resolution taking >2 hours
- Database or infrastructure issue suspected
- Need help from external team (Vercel, Supabase)

**Escalation Contacts:**
- Tech Lead: [Contact info]
- DevOps: [Contact info]
- CTO: [Contact info]

---

## Related Runbooks

- [BetterStack Downtime Alert](./betterstack-downtime-alert.md)
- [Database Performance Issues](./database-performance.md)
- [Rollback Procedure](./rollback-procedure.md)
