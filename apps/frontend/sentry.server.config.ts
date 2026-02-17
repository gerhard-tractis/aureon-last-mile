// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sanitizeEvent } from "@/lib/sentry/sanitize";

// Validate Sentry DSN before initialization
const sentryDsn = process.env.SENTRY_DSN;

if (!sentryDsn) {
  console.warn('[Sentry] SENTRY_DSN not configured - server-side error tracking disabled');
}

Sentry.init({
  dsn: sentryDsn,

  // Adjust trace sampling based on environment (10% in production to reduce overhead)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,

  // Sanitize sensitive data before sending to Sentry (GDPR/privacy compliance)
  beforeSend: (event, hint) => {
    console.log('[Sentry Server] beforeSend wrapper called');
    return sanitizeEvent(event, hint);
  },
});
