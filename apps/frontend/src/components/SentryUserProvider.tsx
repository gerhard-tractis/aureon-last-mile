'use client';

import { useSentryUser } from '@/hooks/useSentryUser';

/**
 * SentryUserProvider
 *
 * Client component wrapper for useSentryUser hook.
 * Automatically enriches Sentry with authenticated user context.
 *
 * Must be used in client component tree since hooks require client-side execution.
 *
 * Usage: Add to root layout to enable user context tracking across entire app.
 */
export default function SentryUserProvider() {
  useSentryUser();
  return null; // This component only provides side effects, no UI
}
