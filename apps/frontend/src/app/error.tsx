'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Global Error Boundary
 *
 * Catches unhandled errors in the application and reports them to Sentry.
 * Displays user-friendly error UI instead of crashing the entire app.
 *
 * Automatically integrated by Next.js when placed in app/ directory.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Capture error in Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="flex flex-col items-center justify-center min-h-screen p-5 font-sans">
          <h1 className="text-2xl mb-4">
            Something went wrong
          </h1>
          <p className="text-muted-foreground mb-6 max-w-[500px] text-center">
            We&apos;re sorry for the inconvenience. Our team has been notified and is working to fix the issue.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground mb-6">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="px-6 py-3 bg-primary-600 text-white border-none rounded-md text-base cursor-pointer"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
