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
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
            Algo salió mal
          </h1>
          <p style={{ marginBottom: '2rem', color: '#666' }}>
            Lo sentimos, ocurrió un error inesperado.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Reintentar
          </button>
          {process.env.NODE_ENV === 'development' && error.digest && (
            <p style={{ marginTop: '2rem', fontSize: '0.875rem', color: '#999' }}>
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
