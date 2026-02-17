# Monitoring & Alerting Architecture

**Last Updated:** 2026-02-17
**Story:** 1.8 - Set Up Monitoring and Alerting (Sentry + BetterStack)
**Status:** Implemented

---

## Overview

Aureon Last Mile uses a dual-stack monitoring approach:

1. **Sentry** - Error tracking, performance monitoring, session replay
2. **BetterStack** (Manual Setup Required) - Uptime monitoring, SSL checks, alerts

**Goal:** Detect incidents before users report them. Reduce MTTR with rich error context.

---

## Architecture

### Sentry Error Tracking

**Client-Side:**
- **Config:** `sentry.client.config.ts`
- **Features:**
  - Automatic error capture
  - Session replay (10% sample rate)
  - Performance monitoring (10% traces in production)
  - User context enrichment (see User Context section)
  - Breadcrumbs (automatic + custom)
  - Sensitive data sanitization (GDPR/privacy compliant)

**Server-Side:**
- **Config:** `sentry.server.config.ts`
- **Features:**
  - API route error tracking
  - Server-side exception capture
  - Request context (method, URL, headers - sanitized)

**Error Boundary:**
- **File:** `src/app/error.tsx`
- **Purpose:** Catch unhandled React errors, display user-friendly UI

**API Middleware:**
- **File:** `src/lib/sentry/middleware.ts`
- **Usage:** Wrap API routes with `withSentry(handler)`
- **Purpose:** Automatic error capture with request context

### User Context Enrichment

**Hook:** `src/hooks/useSentryUser.ts`
**Integration:** Injected via `SentryUserProvider` in root layout

**Captured Context:**
```typescript
{
  id: user.id,
  email: user.email (masked: "joh***@example.com"),
  username: user.full_name,
  operator_id: user.operator_id,  // Multi-tenant context
  role: user.role                  // RBAC context
}
```

**Benefits:**
- Filter errors by operator (multi-tenant debugging)
- Identify affected users
- Correlate errors with user roles/permissions

### Sensitive Data Sanitization

**File:** `src/lib/sentry/sanitize.ts`
**Applied:** Before all events sent to Sentry (beforeSend hook)

**Sanitization Rules:**
1. Remove headers: Authorization, Cookie, X-API-Key
2. Redact fields: password, token, secret, api_key
3. Mask user emails: Show first 3 chars + domain
4. Fail-open: Send unsanitized event if sanitization fails

**Privacy Compliance:** GDPR, Chilean data protection laws

### Error Sampling (Quota Management)

**Free Tier Limit:** 5,000 errors/month
**Strategy:** Priority-based sampling

| Event Level | Sample Rate | Rationale |
|-------------|-------------|-----------|
| Fatal       | 100%        | Critical errors always captured |
| Error       | 100%        | High-priority issues |
| Warning     | 50%         | Reduce noise, stay within quota |
| Info/Debug  | 50%         | Low-priority events |

**Implementation:** `applyErrorSampling()` in `src/lib/sentry/sanitize.ts`

### Custom Breadcrumbs

**File:** `src/lib/sentry/breadcrumbs.ts`
**Helpers:**
- `addActionBreadcrumb()` - User actions (e.g., "Scanned barcode 12345")
- `addNavigationBreadcrumb()` - Route changes
- `addAPIBreadcrumb()` - API calls (endpoint, status, duration)
- `addStateBreadcrumb()` - State changes (e.g., role changed)
- `addErrorBreadcrumb()` - Non-fatal errors
- `addWarningBreadcrumb()` - Warning events

**Example Usage:**
```typescript
import { addActionBreadcrumb } from '@/lib/sentry/breadcrumbs';

function handleBarcodeScan(barcode: string) {
  addActionBreadcrumb('Scanned barcode', { barcode });
  // ... rest of logic
}
```

### Health Check Endpoint

**Endpoint:** `GET /api/health`
**Purpose:** Uptime monitoring (BetterStack, Pingdom, etc.)

**Checks:**
1. **Database Connectivity:** Query `operators` table
2. **Memory Usage:** Alert if >80% heap used

**Response:**
```json
{
  "status": "healthy" | "unhealthy",
  "checks": {
    "database": true | false,
    "memory": true | false,
    "timestamp": "2026-02-17T13:45:00.000Z"
  },
  "memory": {
    "heapUsed": "45MB",
    "heapTotal": "128MB",
    "usagePercent": "35%"
  }
}
```

**Status Codes:**
- `200` - All checks passed (healthy)
- `503` - One or more checks failed (unhealthy)

**Rate Limiting:** Recommend 60 req/min per IP (BetterStack checks every 5 min)

---

## BetterStack Configuration

⚠️ **Manual Setup Required** - Create account at [betterstack.com](https://betterstack.com)

### Uptime Monitors

**Monitor 1: Frontend**
- URL: `https://app.aureon.com`
- Interval: 5 minutes
- Expected: Status 200
- Regions: Multi-region (US, EU, Asia)

**Monitor 2: Health Check**
- URL: `https://app.aureon.com/api/health`
- Interval: 5 minutes
- Expected: Response contains `"status": "healthy"`
- Timeout: 10 seconds

### SSL Certificate Monitoring

- Domain: `aureon.com`, `app.aureon.com`
- Alert threshold: 7 days before expiration

### Alert Rules

**Uptime Alerts:**
- Endpoint down >5 minutes (2 consecutive failures)
- Response time >10 seconds
- SSL certificate expires in <7 days

**Alert Channels:**
- Email: DevOps team
- SMS (optional, paid): On-call phone
- Slack (optional): #alerts channel

---

## Sentry Alert Rules

⚠️ **Manual Setup Required** - Configure in Sentry dashboard

**Rule 1: High Error Rate**
- Condition: Error count >5% of total events in 5-minute window
- Action: Email DevOps team

**Rule 2: New Error Type**
- Condition: First occurrence of error
- Action: Email DevOps team

**Rule 3: High-Impact Error**
- Condition: Error affects >10 unique users in 5-minute window
- Action: Email + Slack message

**Alert Grouping:**
- Group similar errors by fingerprint
- Send digest every 30 minutes (prevent alert fatigue)

---

## Environment Variables

```bash
# Sentry (already configured in .env.local)
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.us.sentry.io/xxx
SENTRY_DSN=https://xxx@xxx.ingest.us.sentry.io/xxx  # Server-side
SENTRY_ORG=tractis
SENTRY_PROJECT=aureon-last-mile
SENTRY_AUTH_TOKEN=sntryu_xxx  # Build-time (source map upload)

# BetterStack (optional, for API integration)
BETTERSTACK_API_KEY=xxx
```

**Vercel Environment Variables:**
- Add `NEXT_PUBLIC_SENTRY_DSN` to production + preview environments
- Add `SENTRY_AUTH_TOKEN` as build-time variable

---

## Testing

**Test Files:**
- `src/hooks/useSentryUser.test.ts` - User context enrichment
- `src/lib/sentry/sanitize.test.ts` - Sanitization + sampling
- `src/lib/sentry/breadcrumbs.test.ts` - Custom breadcrumbs
- `src/lib/sentry/middleware.test.ts` - API error tracking
- `src/app/api/health/route.test.ts` - Health check endpoint

**Run Tests:**
```bash
npm test -- sentry
npm test -- health
```

---

## Troubleshooting

### Sentry not capturing errors

1. Check DSN configured: `console.log(process.env.NEXT_PUBLIC_SENTRY_DSN)`
2. Check network tab: Look for POST to `sentry.io/api`
3. Check beforeSend hook: Event may be sampled or sanitized to null
4. Check ignoreErrors: Event might match filter list

### Health check endpoint failing

1. Check database connectivity: `SELECT id FROM operators LIMIT 1`
2. Check memory usage: `process.memoryUsage()`
3. Check response format: Should return JSON with `status` field

### Source maps not uploaded

1. Check `SENTRY_AUTH_TOKEN` in build environment
2. Check build logs: Look for "Sentry source maps uploaded"
3. Verify auth token scopes: `project:read`, `project:releases`, `org:read`

---

## Future Enhancements

- [ ] Integrate Sentry with Slack for real-time alerts
- [ ] Create public status page with BetterStack
- [ ] Add performance budgets (page load <3s, API response <500ms)
- [ ] Implement custom Sentry tags for feature flags
- [ ] Add distributed tracing for microservices (if architecture evolves)
- [ ] Create Grafana dashboard combining Sentry + BetterStack metrics

---

## References

- [Sentry Next.js Docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [BetterStack Uptime Monitoring](https://betterstack.com/docs/uptime/)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

---

**For Incident Response Runbooks:**
- See `docs/runbooks/sentry-high-error-rate.md`
- See `docs/runbooks/betterstack-downtime-alert.md`
- See `docs/runbooks/ssl-certificate-renewal.md`
