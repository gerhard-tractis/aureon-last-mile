# Story 1.8: Set Up Monitoring and Alerting (Sentry + BetterStack)

**Epic:** 1 - Platform Foundation & Multi-Tenant SaaS Setup
**Status:** ready-for-dev
**Story ID:** 1.8
**Story Key:** 1-8-set-up-monitoring-and-alerting-sentry-betterstack

---

## Story

As an **Aureon DevOps engineer**,
I want **real-time error tracking and uptime monitoring with automated alerts**,
So that **I know immediately when the platform is down or throwing errors**.

---

## Business Context

This story establishes the **observability foundation** for production reliability:

**Critical Success Factors:**
- **Proactive incident detection**: Know about errors before users report them
- **Rapid debugging**: Rich error context (stack traces, user context, breadcrumbs) reduces MTTR
- **Uptime visibility**: SLA tracking and performance monitoring (response times, availability)
- **Alert escalation**: Right person notified at right time (email, SMS, Slack)

**Business Impact:**
- Reduces Mean Time to Resolution (MTTR): From hours to minutes with rich error context
- Prevents revenue loss: Detect downtime within 5 minutes (vs hours without monitoring)
- Improves user experience: Fix errors before they affect >10 users
- Supports SLA commitments: 99.9% uptime guarantee to enterprise customers
- Enables data-driven decisions: Error trends inform feature prioritization

**Dependency Context:**
- **Blocks**: None (last story in Epic 1, enables production readiness)
- **Depends on**: Story 1.7 (CI/CD for deployment automation), Story 1.1-1.6 (features to monitor)

---

## Acceptance Criteria

### Given
- ✅ Application is deployed to Vercel (frontend)
- ✅ Supabase is configured (backend/database)
- ✅ CI/CD pipeline deploys to production (Story 1.7)
- ✅ Sentry account exists (free tier: 5,000 errors/month)
- ✅ BetterStack account exists (free tier: 3 monitors, 5-minute checks)

### When
- I configure Sentry and BetterStack integrations

### Then
- ✅ **Sentry is initialized** in the Next.js app with DSN from environment variable `SENTRY_DSN`
- ✅ **Frontend errors are captured** with:
  - Stack traces (source maps uploaded for readable traces)
  - User context: `user_id`, `operator_id`, `role` (from JWT)
  - Breadcrumbs: Last 10 user actions (page navigations, button clicks, API calls)
  - Environment: `production`, `staging`, `development`
- ✅ **Backend API errors are captured** with:
  - Request context: endpoint, method, headers, body (sanitized, no PII)
  - Error context: stack trace, error message, error type
  - Performance data: request duration, database query time
- ✅ **Sentry groups errors** by fingerprint and shows:
  - Error count (total occurrences)
  - Affected users (unique user_ids)
  - First seen / Last seen timestamps
  - Suggested fixes (AI-powered issue analysis)
- ✅ **BetterStack monitors endpoints**:
  - `https://app.aureon.com` (every 5 minutes)
  - `https://app.aureon.com/api/health` (every 5 minutes, health check endpoint)
  - SSL certificate expiration monitoring
- ✅ **Uptime alerts** are sent via email and SMS when:
  - Endpoint down >5 minutes (consecutive failed checks)
  - Response time >10 seconds (performance degradation)
  - SSL certificate expires in <7 days (renewal reminder)
- ✅ **Error alerts** are sent via email when:
  - Error rate >5% over 5-minute window (spike detection)
  - New error type appears (first occurrence)
  - Error affects >10 users (high-impact incident)

### Edge Cases Handled
- ❌ **Sentry initialization fails** → App works normally, errors not tracked (fail-open)
- ❌ **BetterStack API unreachable** → No uptime monitoring, alert DevOps manually
- ❌ **Alert fatigue** (too many alerts) → Group similar alerts, send digest every 30 minutes instead of per-error
- ❌ **Free tier limits exceeded** (5,000 Sentry errors/month) → Throttle error reporting to critical errors only
- ❌ **PII in error context** → Sanitize user data (emails, passwords, tokens) before sending to Sentry
- ❌ **Source map upload fails** → Errors show minified stack traces (degraded but functional)

---

## Tasks / Subtasks

### Task 1: Configure Sentry for Frontend Error Tracking (AC: Sentry initialized, frontend errors captured)
- [ ] **1.1** Create Sentry account and project
  - Navigate to: [sentry.io](https://sentry.io) → Create project
  - Select platform: Next.js
  - Copy DSN: `https://xxx@xxx.ingest.sentry.io/xxx`
- [ ] **1.2** Install Sentry SDK
  - Run: `npx @sentry/wizard@latest -i nextjs`
  - Wizard creates: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
  - Wizard updates: `next.config.js` with Sentry webpack plugin
- [ ] **1.3** Configure Sentry environment variables
  - Add to `.env.local`: `SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx`
  - Add to `.env.production`: `SENTRY_DSN=${{ secrets.SENTRY_DSN }}`
  - Add to Vercel environment variables: `SENTRY_DSN` (production + preview)
- [ ] **1.4** Configure Sentry initialization (client-side)
  - File: `sentry.client.config.ts`
  - Options:
    - `dsn`: from environment variable
    - `environment`: `process.env.NODE_ENV`
    - `tracesSampleRate`: 0.1 (10% of transactions for performance monitoring)
    - `replaysSessionSampleRate`: 0.1 (10% of sessions for session replay)
    - `replaysOnErrorSampleRate`: 1.0 (100% of sessions with errors)
- [ ] **1.5** Configure Sentry initialization (server-side)
  - File: `sentry.server.config.ts`
  - Options: Same as client + `integrations: [new Sentry.Integrations.Http({ tracing: true })]`
- [ ] **1.6** Add user context enrichment
  - Create hook: `hooks/useSentryUser.ts`
  - On auth state change → Call `Sentry.setUser({ id, email, operator_id, role })`
  - On logout → Call `Sentry.setUser(null)`

### Task 2: Configure Breadcrumbs and Error Context (AC: Breadcrumbs, user context)
- [ ] **2.1** Enable automatic breadcrumbs
  - Enabled by default in Sentry SDK
  - Captures: Console logs, network requests, DOM events, navigation
  - Max breadcrumbs: 100 (last 100 events before error)
- [ ] **2.2** Add custom breadcrumbs for critical actions
  - Example: Barcode scan, manifest creation, user role change
  - Use: `Sentry.addBreadcrumb({ category: 'action', message: 'Scanned barcode 12345', level: 'info' })`
- [ ] **2.3** Configure sensitive data scrubbing
  - File: `sentry.client.config.ts`
  - Add: `beforeSend` hook to sanitize data
  - Remove: Passwords, tokens, credit card numbers, emails (except logged-in user)
  - Example:
    ```typescript
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['Authorization'];
        delete event.request.headers['Cookie'];
      }
      // Sanitize user email (show domain only)
      if (event.user?.email) {
        event.user.email = event.user.email.replace(/(.{3}).*(@.*)/, '$1***$2');
      }
      return event;
    }
    ```

### Task 3: Configure Source Maps Upload (AC: Stack traces readable)
- [ ] **3.1** Configure Sentry webpack plugin
  - Already configured by wizard in `next.config.js`
  - Uploads source maps on production builds
  - Requires: `SENTRY_AUTH_TOKEN` environment variable
- [ ] **3.2** Create Sentry auth token
  - Navigate to: Sentry → Settings → Auth Tokens → Create New Token
  - Scopes: `project:read`, `project:releases`, `org:read`
  - Copy token: `sntrys_xxx`
- [ ] **3.3** Add auth token to CI/CD
  - Add GitHub Actions secret: `SENTRY_AUTH_TOKEN`
  - Add to Vercel environment variable: `SENTRY_AUTH_TOKEN` (build-time only, not runtime)
- [ ] **3.4** Test source map upload
  - Run production build: `npm run build`
  - Verify source maps uploaded: Sentry → Settings → Source Maps
  - Trigger test error → Verify stack trace shows original TypeScript code (not minified)

### Task 4: Configure Backend API Error Tracking (AC: Backend errors captured)
- [ ] **4.1** Add Sentry error handler to API routes
  - Create middleware: `lib/sentry-middleware.ts`
  - Wraps API route handlers with try/catch
  - Example:
    ```typescript
    export function withSentry(handler: NextApiHandler): NextApiHandler {
      return async (req, res) => {
        try {
          await handler(req, res);
        } catch (error) {
          Sentry.captureException(error, {
            contexts: {
              request: {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: sanitize(req.body),
              },
            },
          });
          throw error;
        }
      };
    }
    ```
- [ ] **4.2** Apply middleware to all API routes
  - Update: `app/api/**/route.ts`
  - Wrap handlers: `export const POST = withSentry(async (req) => { ... })`
- [ ] **4.3** Add Sentry to global error handler
  - File: `app/error.tsx` (Next.js error boundary)
  - Capture errors: `Sentry.captureException(error)`
  - Show user-friendly error UI

### Task 5: Configure BetterStack Uptime Monitoring (AC: BetterStack monitors endpoints)
- [ ] **5.1** Create BetterStack account
  - Navigate to: [betterstack.com](https://betterstack.com) → Sign up
  - Select plan: Free tier (3 monitors, 5-minute checks)
- [ ] **5.2** Create uptime monitor for frontend
  - Navigate to: BetterStack → Monitors → Create Monitor
  - URL: `https://app.aureon.com`
  - Check interval: 5 minutes
  - Expected status code: 200
  - Timeout: 30 seconds
  - Regions: Multi-region (US, EU, Asia)
- [ ] **5.3** Create health check endpoint
  - File: `app/api/health/route.ts`
  - Checks:
    - Database connectivity: `SELECT 1` query to Supabase
    - External API connectivity: Ping critical services
    - Memory usage: `process.memoryUsage()`
  - Response: `{ status: 'healthy', timestamp: Date.now(), checks: {...} }`
- [ ] **5.4** Create uptime monitor for health endpoint
  - URL: `https://app.aureon.com/api/health`
  - Check interval: 5 minutes
  - Expected response: Contains `"status": "healthy"`
  - Timeout: 10 seconds
- [ ] **5.5** Configure SSL certificate monitoring
  - Navigate to: BetterStack → Monitors → SSL Monitoring
  - Domain: `aureon.com`, `app.aureon.com`
  - Alert threshold: 7 days before expiration

### Task 6: Configure Alert Rules and Notifications (AC: Alerts sent via email/SMS)
- [ ] **6.1** Configure BetterStack alert channels
  - Navigate to: BetterStack → Alert Channels → Add Channel
  - Add email: DevOps team email (e.g., devops@aureon.com)
  - Add SMS: On-call phone number (optional, paid feature)
  - Add Slack: Create webhook, integrate with #alerts channel
- [ ] **6.2** Configure uptime alert rules
  - Alert when: Endpoint down >5 minutes (2 consecutive failed checks)
  - Alert when: Response time >10 seconds (performance degradation)
  - Alert when: SSL certificate expires in <7 days
  - Escalation: Email (immediate) → SMS (after 15 minutes) → Phone call (after 30 minutes)
- [ ] **6.3** Configure Sentry alert rules
  - Navigate to: Sentry → Alerts → Create Alert Rule
  - Rule 1: "High Error Rate"
    - Condition: Error count >5% of total events in 5-minute window
    - Action: Send email to DevOps team
  - Rule 2: "New Error Type"
    - Condition: First occurrence of error
    - Action: Send email to DevOps team
  - Rule 3: "High-Impact Error"
    - Condition: Error affects >10 unique users in 5-minute window
    - Action: Send email + create Slack message
- [ ] **6.4** Configure alert grouping (prevent alert fatigue)
  - Sentry: Group similar errors by fingerprint
  - BetterStack: Send alert digest every 30 minutes (instead of per-incident)
  - Slack: Use threads to group related alerts

### Task 7: Configure Error Rate Limiting (AC: Free tier limits not exceeded)
- [ ] **7.1** Implement client-side error sampling
  - File: `sentry.client.config.ts`
  - Add: `beforeSend` hook with sampling logic
  - Example:
    ```typescript
    beforeSend(event, hint) {
      // Sample 100% of errors in production initially
      // If approaching quota, reduce to 50% or filter low-priority errors
      const isHighPriority = event.level === 'fatal' || event.level === 'error';
      if (!isHighPriority && Math.random() > 0.5) {
        return null; // Drop 50% of warnings/info
      }
      return event;
    }
    ```
- [ ] **7.2** Configure Sentry quota alerts
  - Navigate to: Sentry → Settings → Quotas
  - Set alert threshold: 80% of monthly quota (4,000 / 5,000 errors)
  - Action: Email DevOps team to review error rate
- [ ] **7.3** Implement error deduplication
  - Use Sentry fingerprinting to group duplicate errors
  - Example: Same error from same user within 1 minute = 1 event

### Task 8: Create Monitoring Dashboard and Runbooks (AC: Documentation)
- [ ] **8.1** Create monitoring dashboard
  - Sentry: Pin critical error queries to dashboard (high-frequency errors, new errors)
  - BetterStack: Create status page (public or private) showing uptime metrics
  - Grafana (optional): Combine Sentry + BetterStack metrics in unified dashboard
- [ ] **8.2** Document monitoring architecture
  - Create: `docs/monitoring-architecture.md`
  - Include: Sentry setup, BetterStack configuration, alert rules, escalation paths
- [ ] **8.3** Create incident response runbooks
  - `docs/runbooks/sentry-high-error-rate.md` - How to investigate error spikes
  - `docs/runbooks/betterstack-downtime-alert.md` - How to respond to downtime
  - `docs/runbooks/ssl-certificate-renewal.md` - SSL renewal process
- [ ] **8.4** Update sprint-status.yaml
  - Update story status: `backlog` → `ready-for-dev` (at completion)

### Task 9: Write Tests for Monitoring Integration (AC: Testing)
- [ ] **9.1** Test Sentry error capture (frontend)
  - Create test button: "Trigger Test Error"
  - Click button → Verify error appears in Sentry dashboard
  - Verify: User context (user_id, operator_id, role), breadcrumbs, stack trace
- [ ] **9.2** Test Sentry error capture (backend)
  - Create API endpoint: `/api/test-error`
  - Call endpoint → Verify error appears in Sentry dashboard
  - Verify: Request context (method, URL, headers, body)
- [ ] **9.3** Test BetterStack uptime monitoring
  - Stop Vercel deployment (simulate downtime)
  - Wait 5 minutes → Verify BetterStack alert received via email/Slack
  - Restart deployment → Verify recovery alert
- [ ] **9.4** Test health check endpoint
  - Call `/api/health` → Verify `{ status: 'healthy' }` response
  - Stop database → Call endpoint → Verify `{ status: 'unhealthy', error: 'Database connection failed' }`
- [ ] **9.5** Test alert escalation
  - Trigger high error rate (>5% in 5 minutes)
  - Verify: Sentry alert sent to email
  - Trigger downtime (>5 minutes)
  - Verify: BetterStack alert sent to email → SMS (if configured)

---

## Dev Notes

### 🏗️ Architecture Patterns

**CRITICAL: Follow 2026 Sentry + BetterStack best practices!**

#### 1. Fail-Open Error Tracking (Never Block User)

**Why Fail-Open:**
- ✅ User experience: App works even if Sentry is down
- ✅ Reliability: Monitoring failure doesn't cause app failure
- ⚠️ Trade-off: Some errors might be lost if Sentry is unreachable

**Implementation:**
```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Fail-open: Don't throw if Sentry is unreachable
  beforeSend(event, hint) {
    try {
      // Sanitize sensitive data
      return sanitize(event);
    } catch (error) {
      console.error('Sentry beforeSend failed:', error);
      return event; // Send unsanitized rather than dropping
    }
  },

  // Performance monitoring (10% sample rate)
  tracesSampleRate: 0.1,

  // Session replay (10% of sessions, 100% of error sessions)
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

#### 2. User Context Enrichment (Multi-Tenant Aware)

**Why User Context Matters:**
- ✅ Debugging: Know which operator/user hit the error
- ✅ Impact analysis: How many users affected by this error?
- ✅ Multi-tenant isolation: Filter errors by operator_id

**Implementation:**
```typescript
// hooks/useSentryUser.ts
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useAuth } from '@/lib/auth';

export function useSentryUser() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.full_name,
        // Custom context for multi-tenant debugging
        operator_id: user.operator_id,
        role: user.role,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);
}

// Usage in app layout
export default function RootLayout({ children }) {
  useSentryUser(); // Auto-update Sentry user context
  return <>{children}</>;
}
```

#### 3. Health Check Endpoint Pattern (Comprehensive Checks)

**Why Health Checks:**
- ✅ Proactive monitoring: Detect issues before users notice
- ✅ Dependency visibility: Database, APIs, external services
- ✅ Debugging: Know which component is failing

**Implementation:**
```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic'; // Disable caching

export async function GET() {
  const checks = {
    database: false,
    memory: false,
    timestamp: new Date().toISOString(),
  };

  try {
    // Check 1: Database connectivity
    const supabase = createClient();
    const { error } = await supabase.from('operators').select('id').limit(1);
    checks.database = !error;

    // Check 2: Memory usage (warn if >80%)
    const memUsage = process.memoryUsage();
    const memUsagePct = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    checks.memory = memUsagePct < 80;

    // Overall health
    const isHealthy = checks.database && checks.memory;

    return NextResponse.json(
      {
        status: isHealthy ? 'healthy' : 'unhealthy',
        checks,
        memory: {
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        },
      },
      { status: isHealthy ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        checks,
      },
      { status: 503 }
    );
  }
}
```

#### 4. Sensitive Data Sanitization (PII Protection)

**Why Sanitize:**
- ✅ Privacy compliance: GDPR, Chilean data protection laws
- ✅ Security: Prevent tokens/passwords from being logged
- ⚠️ Trade-off: Less debug context (balance privacy vs debuggability)

**Implementation:**
```typescript
// lib/sentry-sanitize.ts
export function sanitize(event: Sentry.Event): Sentry.Event {
  // Remove sensitive headers
  if (event.request?.headers) {
    const sensitiveHeaders = ['Authorization', 'Cookie', 'X-Api-Key'];
    sensitiveHeaders.forEach(header => {
      delete event.request!.headers![header.toLowerCase()];
    });
  }

  // Sanitize request body (remove passwords, tokens)
  if (event.request?.data) {
    const sensitiveFields = ['password', 'token', 'secret', 'api_key'];
    sensitiveFields.forEach(field => {
      if (event.request!.data[field]) {
        event.request!.data[field] = '[REDACTED]';
      }
    });
  }

  // Mask user email (show domain only)
  if (event.user?.email) {
    event.user.email = event.user.email.replace(/(.{3}).*(@.*)/, '$1***$2');
  }

  return event;
}
```

#### 5. BetterStack Multi-Region Monitoring

**Why Multi-Region:**
- ✅ Global coverage: Detect regional outages
- ✅ Latency detection: Response time varies by region
- ✅ CDN verification: Ensure Vercel edge nodes are healthy

**Configuration:**
```yaml
# BetterStack Monitor Configuration (via UI)
URL: https://app.aureon.com
Regions: [US-East, US-West, EU-West, Asia-Pacific]
Interval: 5 minutes
Timeout: 30 seconds
Expected Status: 200
Expected Content: Contains "Aureon" (verify HTML loaded)
Alert Threshold: 2 consecutive failures (10 minutes downtime)
```

---

### 📂 Source Tree

**Files to Create:**
```
apps/frontend/
├── sentry.client.config.ts                             # CREATE (via wizard)
├── sentry.server.config.ts                             # CREATE (via wizard)
├── sentry.edge.config.ts                               # CREATE (via wizard)
├── lib/
│   ├── sentry-middleware.ts                            # CREATE
│   └── sentry-sanitize.ts                              # CREATE
├── hooks/
│   └── useSentryUser.ts                                # CREATE
├── app/
│   └── api/
│       ├── health/
│       │   └── route.ts                                # CREATE
│       └── test-error/
│           └── route.ts                                # CREATE (testing only)
└── docs/
    ├── monitoring-architecture.md                      # CREATE
    └── runbooks/
        ├── sentry-high-error-rate.md                   # CREATE
        ├── betterstack-downtime-alert.md               # CREATE
        └── ssl-certificate-renewal.md                  # CREATE
```

**Files to Update:**
```
next.config.js - Updated by Sentry wizard (webpack plugin)
.env.local - Add SENTRY_DSN, SENTRY_AUTH_TOKEN
.env.production - Add SENTRY_DSN (from secrets)
app/layout.tsx - Add useSentryUser() hook
README.md - Add uptime/status badges
```

**Environment Variables:**
```bash
# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=sntrys_xxx  # Build-time only (source map upload)
SENTRY_ORG=aureon
SENTRY_PROJECT=aureon-last-mile

# BetterStack (optional, for API integration)
BETTERSTACK_API_KEY=xxx  # For programmatic monitor creation
```

---

### 📚 References

**Sentry Documentation (2026):**
- [Sentry Next.js Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Session Replay](https://docs.sentry.io/platforms/javascript/session-replay/)
- [Source Maps](https://docs.sentry.io/platforms/javascript/sourcemaps/)

**BetterStack Documentation:**
- [Uptime Monitoring](https://betterstack.com/docs/uptime/)
- [Status Pages](https://betterstack.com/docs/uptime/status-pages/)
- [Alert Integrations](https://betterstack.com/docs/uptime/integrations/)

**Best Practices:**
- [Error Monitoring Best Practices](https://blog.sentry.io/error-monitoring-best-practices/)
- [Health Check Patterns](https://microservices.io/patterns/observability/health-check-api.html)

---

## Dev Agent Record

**🚀 This story provides:**
- ✅ Real-time error tracking with rich context (user, operator, breadcrumbs)
- ✅ Uptime monitoring with 5-minute checks (multi-region)
- ✅ Automated alerts (email, SMS, Slack) with escalation
- ✅ Privacy-compliant (sanitized PII, GDPR-ready)

**Developer: Production observability. Know when things break before users do!**
