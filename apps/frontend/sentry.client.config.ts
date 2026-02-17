// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sanitizeEvent } from "@/lib/sentry/sanitize";

// Validate Sentry DSN before initialization
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (!sentryDsn) {
  console.warn('[Sentry] NEXT_PUBLIC_SENTRY_DSN not configured - error tracking disabled');
}

Sentry.init({
  dsn: sentryDsn,

  // Adjust trace sampling based on environment (10% in production to reduce overhead)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Capture 10% of errors with session replay (prevents quota exhaustion)
  replaysOnErrorSampleRate: 0.1,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,

  // Sanitize sensitive data before sending to Sentry (GDPR/privacy compliance)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeSend: sanitizeEvent as any,

  // Ignore common browser errors
  ignoreErrors: [
    // Random plugins/extensions
    'top.GLOBALS',
    // See: http://blog.errorception.com/2012/03/tale-of-unfindable-js-error.html
    'originalCreateNotification',
    'canvas.contentDocument',
    'MyApp_RemoveAllHighlights',
    'http://tt.epicplay.com',
    "Can't find variable: ZiteReader",
    'jigsaw is not defined',
    'ComboSearch is not defined',
    'http://loading.retry.widdit.com/',
    'atomicFindClose',
    // Facebook blocked
    'fb_xd_fragment',
    // ISP optimizing proxy - `Cache-Control: no-transform` seems to reduce this. (thanks @acdha)
    'bmi_SafeAddOnload',
    'EBCallBackMessageReceived',
    // See http://toolbar.conduit.com/Developer/HtmlAndGadget/Methods/JSInjection.aspx
    'conduitPage',
  ],
});
