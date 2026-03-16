'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Global error handler for React rendering errors in App Router
// This catches errors that occur during rendering and reports them to Sentry
// See: https://nextjs.org/docs/app/api-reference/file-conventions/error#global-errorjs

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to Sentry
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'global',
      },
      extra: {
        digest: error.digest,
      },
    });
  }, [error]);

  return (
    <html>
      <body>
        <div className="flex flex-col items-center justify-center h-screen font-sans p-8 text-center">
          <h1 className="text-[2rem] mb-4">
            Algo salió mal
          </h1>
          <p className="mb-8 text-muted-foreground">
            Lo sentimos, ocurrió un error inesperado.
          </p>
          <button
            onClick={reset}
            className="py-3 px-6 bg-primary-600 text-white border-none rounded-lg cursor-pointer text-base"
          >
            Reintentar
          </button>
          {process.env.NODE_ENV === 'development' && error.digest && (
            <p className="mt-8 text-sm text-muted-foreground">
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
