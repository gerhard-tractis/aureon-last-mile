// This file configures the initialization of Sentry for edge features (middleware, edge routes, and edge runtime).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// Validate Sentry DSN before initialization
const sentryDsn = process.env.SENTRY_DSN;

if (!sentryDsn) {
  console.warn('[Sentry] SENTRY_DSN not configured - edge runtime error tracking disabled');
}

Sentry.init({
  dsn: sentryDsn,

  // Adjust trace sampling based on environment (10% in production to reduce overhead)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
});
