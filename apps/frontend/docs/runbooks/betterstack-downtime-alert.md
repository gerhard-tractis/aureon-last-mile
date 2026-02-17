# Runbook: BetterStack Downtime Alert

**Alert Type:** Application Downtime
**Severity:** Critical
**SLA:** Acknowledge within 5 minutes, restore service within 30 minutes

---

## Alert Trigger

**Condition:** Endpoint down >5 minutes (2 consecutive failed checks)

**Example Alert:**
```
[BetterStack Alert] https://app.aureon.com is DOWN
Status: 503 Service Unavailable
Duration: 10 minutes
Region: US-East, EU-West (multi-region failure)
Last Check: 2026-02-17 13:45:00
```

---

## Immediate Actions (First 2 Minutes)

### 1. Acknowledge Alert

Respond to alert in Slack/email to claim ownership:
```
ACK - Investigating downtime alert for app.aureon.com
```

### 2. Verify Downtime

**From your machine:**
```bash
# Check main application
curl -I https://app.aureon.com

# Check health endpoint
curl https://app.aureon.com/api/health
```

**Expected responses:**
- Healthy: `HTTP/2 200 OK` + `{"status":"healthy"}`
- Unhealthy: `HTTP/2 503 Service Unavailable`
- Down: Connection timeout or refused

### 3. Quick Status Check

**Vercel Status:**
Visit [vercel-status.com](https://vercel-status.com)
- Check for platform outages
- Check specific regions (US, EU)

**Supabase Status:**
Visit [status.supabase.com](https://status.supabase.com)
- Check database availability
- Check API gateway status

---

## Investigation Steps

### Step 1: Check Deployment Status

**Vercel Dashboard:**
```bash
# CLI: List recent deployments
vercel ls

# Check deployment logs
vercel logs [deployment-url]
```

**Look for:**
- Recent failed deployment
- Build errors
- Runtime errors in logs

### Step 2: Check Application Health

**Health endpoint details:**
```bash
curl https://app.aureon.com/api/health | jq .
```

**Possible responses:**
```json
{
  "status": "unhealthy",
  "checks": {
    "database": false,  // ← Database connection failed
    "memory": false,    // ← Memory exceeded 80%
    "timestamp": "2026-02-17T13:45:00.000Z"
  }
}
```

**If database check fails:**
→ Go to "Database Issues" section

**If memory check fails:**
→ Go to "Memory Issues" section

### Step 3: Check Error Logs

**Vercel Logs:**
```bash
# Runtime logs (last 100 lines)
vercel logs --follow

# Filter for errors
vercel logs | grep -i error
```

**Sentry Dashboard:**
- Check for error spike in last 15 minutes
- Look for fatal errors or uncaught exceptions

---

## Resolution Strategies

### Database Issues (database check failed)

**Symptoms:**
- Health endpoint returns `"database": false`
- Error: "Database connection failed"

**Actions:**

1. **Check Supabase Dashboard:**
   - Visit [Supabase Project Dashboard](https://app.supabase.com/project/wfwlcpnkkxxzdvhvvsxb)
   - Check "Database" tab for status
   - Check "Reports" for connection pool exhaustion

2. **Check Connection Pool:**
   ```sql
   -- Run in Supabase SQL Editor
   SELECT count(*) FROM pg_stat_activity;
   ```
   - If count >100: Connection pool exhausted
   - Solution: Restart application to clear connections

3. **Check Database CPU/Memory:**
   - Supabase Dashboard → Reports → Resource Usage
   - If >80%: May need to upgrade plan or optimize queries

4. **Emergency: Switch to Maintenance Mode:**
   ```bash
   # Deploy maintenance page
   vercel deploy ./maintenance --prod
   ```

### Memory Issues (memory check failed)

**Symptoms:**
- Health endpoint returns `"memory": false`
- Memory usage >80%

**Actions:**

1. **Check Memory Details:**
   ```bash
   curl https://app.aureon.com/api/health | jq '.memory'
   ```

2. **Restart Application:**
   ```bash
   # Redeploy current version (triggers restart)
   vercel --prod
   ```

3. **Investigate Memory Leak:**
   - Check Vercel logs for gradual memory increase
   - Review recent code changes for unclosed connections
   - Check for large in-memory caches

### Build/Deployment Issues

**Symptoms:**
- Recent deployment failed
- Build errors in logs

**Actions:**

1. **Rollback to Last Stable Deployment:**
   ```bash
   vercel rollback [previous-deployment-url]
   ```

2. **Check Build Logs:**
   - Vercel Dashboard → Deployments → [Failed deployment] → Build Logs
   - Look for: TypeScript errors, missing dependencies, build timeouts

3. **Fix and Redeploy:**
   - Fix build errors locally
   - Test build: `npm run build`
   - Deploy: `vercel --prod`

### Platform Outage (Vercel/Supabase down)

**Symptoms:**
- vercel-status.com shows outage
- Multiple services affected

**Actions:**

1. **Monitor Status Page:**
   - Subscribe to updates
   - Check ETA for resolution

2. **Communicate to Users:**
   - Update status page: "Experiencing platform issues, investigating"
   - Post on social media if prolonged

3. **Consider Alternative Hosting (if extended outage):**
   - Fallback to staging environment
   - Deploy to backup hosting provider (if configured)

---

## Communication

### Internal

**Slack #incidents (immediate):**
```
🚨 DOWNTIME ALERT - app.aureon.com
Status: DOWN (503 Service Unavailable)
Duration: [X] minutes
Cause: [Database/Memory/Deployment/Platform] (investigating)
ETA: [5/15/30] minutes
IC: @[your-name]
```

**Update every 5 minutes until service restored**

### External

**If downtime >10 minutes:**

**Status Page:**
```
⚠️ Service Disruption
We're currently experiencing issues with our application.
Our team is actively working to restore service.
Started: [time]
ETA: [time]
Last Update: [time]
```

**Email to Enterprise Customers (if SLA breach):**
```
Subject: Service Disruption - Aureon Last Mile

We're currently experiencing a service disruption affecting
[application/feature]. We apologize for the inconvenience.

Started: [time]
Current Status: [brief description]
ETA: [time]
Impact: [description]

We'll send updates every 30 minutes until resolved.
```

---

## Post-Incident

### 1. Service Restoration Verification

**Checklist:**
- [ ] Health endpoint returns 200 + `"status":"healthy"`
- [ ] Sample user workflows working (login, dashboard, critical features)
- [ ] No new errors in Sentry
- [ ] BetterStack monitoring shows UP status

**Monitor for 1 hour after restoration**

### 2. Root Cause Analysis

**Answer:**
- What was the root cause?
- When did the issue start?
- What was the trigger?
- Why didn't alerting catch it earlier?
- What was the impact (downtime duration, affected users)?

### 3. Postmortem Document

**Template:**
```markdown
# Postmortem: Downtime on 2026-02-17

## Summary
[Brief description of incident]

## Timeline
- [Time]: Alert triggered
- [Time]: Investigation started
- [Time]: Root cause identified
- [Time]: Fix applied
- [Time]: Service restored

## Root Cause
[Detailed explanation]

## Resolution
[What was done to fix]

## Impact
- Downtime: [X] minutes
- Users affected: [X]
- Revenue impact: [if applicable]

## Action Items
- [ ] [Preventive action 1]
- [ ] [Preventive action 2]
- [ ] [Monitoring improvement]
```

### 4. Follow-up Actions

- Update runbook if process gaps found
- Improve monitoring/alerting if detection was slow
- Add tests to prevent regression
- Review SLA commitments with affected customers

---

## Escalation

**Escalate immediately if:**
- Downtime >30 minutes
- Unable to identify root cause
- Database corruption suspected
- Platform-wide Vercel/Supabase outage

**Escalation Contacts:**
- Tech Lead: [Contact]
- DevOps Engineer: [Contact]
- Vercel Support: support@vercel.com (Priority support if on Pro plan)
- Supabase Support: [Dashboard → Support]

---

## Prevention

**To reduce future downtime:**
- Monitor health endpoint every 5 minutes (BetterStack)
- Set up alerts for database connection pool >70%
- Set up alerts for memory usage >70%
- Implement graceful degradation for non-critical features
- Maintain runbook and test incident response quarterly

---

## Related Runbooks

- [Sentry High Error Rate](./sentry-high-error-rate.md)
- [Database Performance Issues](./database-performance.md)
- [Rollback Procedure](./rollback-procedure.md)
