# Monitoring Setup Guide

This guide covers setting up monitoring and alerting for Aureon Last Mile platform.

## 1. Sentry Error Tracking ✅ CONFIGURED

Sentry is configured for comprehensive error tracking across client, server, and edge runtimes.

### Configuration Files Created:
- `sentry.client.config.ts` - Client-side error tracking with Session Replay
- `sentry.server.config.ts` - Server-side error tracking
- `sentry.edge.config.ts` - Edge runtime error tracking
- `instrumentation.ts` - Next.js instrumentation hook

### Setup Steps:

1. **Create Sentry Account:**
   - Go to https://sentry.io/signup/
   - Select "Free" plan (5,000 events/month)
   - Create organization and project

2. **Get DSN:**
   - Navigate to: Settings → Projects → [Your Project] → Client Keys (DSN)
   - Copy the DSN URL

3. **Configure Environment Variables:**

   Add to `.env.local` (local development):
   ```bash
   NEXT_PUBLIC_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
   SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
   SENTRY_ORG=your-organization-slug
   SENTRY_PROJECT=aureon-last-mile
   SENTRY_AUTH_TOKEN=your-auth-token
   ```

   Add to Vercel dashboard (production):
   - Go to: Vercel Dashboard → Project → Settings → Environment Variables
   - Add all SENTRY_* variables from above
   - Set scope: Production, Preview, Development

4. **Generate Auth Token (for source maps upload):**
   - Go to: Sentry → Settings → Auth Tokens
   - Click "Create New Token"
   - Scopes needed: `project:read`, `project:releases`, `org:read`
   - Copy token and add as `SENTRY_AUTH_TOKEN`

5. **Test Error Tracking:**
   ```typescript
   // Trigger a test error
   import * as Sentry from "@sentry/nextjs";
   Sentry.captureException(new Error("Test error from Aureon Last Mile"));
   ```

6. **Verify in Sentry:**
   - Go to: Sentry Dashboard → Issues
   - You should see the test error appear within seconds

### Features Enabled:
- ✅ Automatic error capture (unhandled exceptions, promise rejections)
- ✅ Session Replay (10% sample rate, 100% on errors)
- ✅ Performance monitoring (100% trace sample rate)
- ✅ Source maps upload (via Sentry webpack plugin)
- ✅ Automatic breadcrumbs (navigation, console, network)
- ✅ React component annotations (full component names in stack traces)
- ✅ Tunneling route (`/monitoring`) to bypass ad-blockers
- ✅ Vercel Cron Monitors integration

---

## 2. BetterStack Uptime Monitoring

BetterStack provides uptime monitoring, status pages, and incident management.

### Setup Steps:

1. **Create BetterStack Account:**
   - Go to https://betterstack.com/uptime
   - Sign up for free plan (10 monitors, 3-minute checks)

2. **Create Uptime Monitor:**
   - Dashboard → Uptime → New Monitor
   - **URL:** `https://aureon-last-mile.vercel.app/`
   - **Name:** Aureon Last Mile - Production
   - **Check Frequency:** 3 minutes (free tier)
   - **Timeout:** 30 seconds
   - **HTTP Method:** GET
   - **Expected Status Code:** 200

3. **Configure Health Check Endpoint (Recommended):**

   Create `/api/health/route.ts`:
   ```typescript
   import { NextResponse } from 'next/server';
   import { createClient } from '@/lib/supabase/server';

   export async function GET() {
     try {
       // Check database connectivity
       const supabase = await createClient();
       const { error } = await supabase.from('operators').select('count').limit(1);

       if (error) {
         return NextResponse.json(
           { status: 'unhealthy', error: 'Database connection failed' },
           { status: 503 }
         );
       }

       return NextResponse.json({
         status: 'healthy',
         timestamp: new Date().toISOString(),
         version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
       });
     } catch (error) {
       return NextResponse.json(
         { status: 'unhealthy', error: 'Internal error' },
         { status: 500 }
       );
     }
   }
   ```

   Update monitor URL to: `https://aureon-last-mile.vercel.app/api/health`

4. **Set Up Alerts:**
   - Dashboard → Monitors → [Your Monitor] → Alerts
   - **On-Call Schedule:** Add your email/phone
   - **Alert Channels:** Email, SMS, Slack (optional)
   - **Escalation Policy:**
     - Alert after: 1 failed check (3 minutes)
     - Escalate after: 2 failed checks (6 minutes)
     - Maximum alerts: 5 per incident

5. **Create Status Page (Optional):**
   - Dashboard → Status Pages → New Status Page
   - **URL:** `aureon-status.betterstack.com`
   - Add Aureon Last Mile monitor
   - Enable subscriber notifications

6. **Configure Maintenance Windows:**
   - Use when deploying updates to prevent false alerts
   - Dashboard → Monitors → [Monitor] → Maintenance

### Expected Uptime SLA:
- **Target:** 99.9% uptime (max 43 minutes downtime/month)
- **Current:** Check BetterStack dashboard for real-time stats

---

## 3. Vercel Analytics

Vercel Analytics provides Web Vitals monitoring and performance insights.

### Setup Steps:

1. **Enable Vercel Analytics:**
   - Go to: Vercel Dashboard → Project → Analytics
   - Click "Enable Analytics"
   - Free tier: 2,500 data points/month
   - Pro tier: Unlimited (requires paid plan)

2. **Install Vercel Analytics Package (Already Done):**
   ```bash
   npm install @vercel/analytics
   ```

3. **Add Analytics Component:**

   Update `app/layout.tsx`:
   ```typescript
   import { Analytics } from '@vercel/analytics/react';

   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           {children}
           <Analytics />
         </body>
       </html>
     );
   }
   ```

4. **Deploy and Verify:**
   - Deploy to Vercel
   - Visit site and navigate between pages
   - Check: Vercel Dashboard → Analytics (data appears within 5 minutes)

5. **Monitor Key Metrics:**
   - **Core Web Vitals:**
     - LCP (Largest Contentful Paint): Target <2.5s
     - FID (First Input Delay): Target <100ms
     - CLS (Cumulative Layout Shift): Target <0.1
   - **Page Views:** Track most popular routes
   - **Visitors:** Unique users per day
   - **Top Pages:** Identify performance bottlenecks

6. **Set Up Alerts (Pro Plan):**
   - Dashboard → Analytics → Settings → Alerts
   - Configure thresholds for Web Vitals
   - Get notified when performance degrades

### Performance Targets:
- ✅ **BI Dashboard load:** ≤2 seconds
- ✅ **API responses:** ≤200ms p95 (reads), ≤500ms p95 (writes)
- ✅ **Barcode scan:** ≤100ms per scan

---

## 4. Railway Dashboard Monitoring (N/A)

**Status:** Not applicable (Railway backend deferred for MVP)

If Railway is added later:
- Dashboard → Project → Metrics
- Monitor: CPU, memory, network, disk usage
- Set alerts for resource threshold violations

---

## Monitoring Dashboard URLs

Once configured, bookmark these:

- **Sentry:** https://sentry.io/organizations/[your-org]/issues/
- **BetterStack:** https://betterstack.com/team/[team-id]/uptime
- **Vercel Analytics:** https://vercel.com/[username]/aureon-last-mile/analytics
- **Supabase Logs:** https://supabase.com/dashboard/project/[project-id]/logs

---

## Testing Monitoring

### Test Sentry Error Tracking:

1. Add test route: `/api/sentry-test/route.ts`
   ```typescript
   import { NextResponse } from 'next/server';

   export async function GET() {
     throw new Error('Sentry test error - monitoring validation');
   }
   ```

2. Visit: `https://aureon-last-mile.vercel.app/api/sentry-test`
3. Check Sentry dashboard for error within 10 seconds

### Test BetterStack Uptime:

1. Temporarily disable site (maintenance mode)
2. Wait 3 minutes for check to fail
3. Verify alert received via email/SMS
4. Re-enable site and verify recovery alert

### Test Vercel Analytics:

1. Visit site and navigate between routes
2. Wait 5 minutes
3. Check Vercel Analytics dashboard for page views

---

## Maintenance

- **Weekly:** Review Sentry error trends, triage critical issues
- **Monthly:** Check uptime SLA compliance (BetterStack reports)
- **Quarterly:** Analyze Vercel Analytics for performance regressions

---

## Cost Summary

| Service | Plan | Cost | Limits |
|---------|------|------|--------|
| Sentry | Free | $0/mo | 5K events/month |
| BetterStack | Free | $0/mo | 10 monitors, 3-min checks |
| Vercel Analytics | Free | $0/mo | 2,500 data points/month |
| **Total** | | **$0/mo** | MVP sufficient |

Upgrade paths available when scaling beyond free tiers.
