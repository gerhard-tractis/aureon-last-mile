import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Sentry Middleware for API Routes
 *
 * Wraps Next.js API route handlers to automatically capture exceptions with request context.
 * Provides fail-safe error handling - rethrows errors after capturing.
 *
 * Request Context Captured:
 * - HTTP method (GET, POST, etc.)
 * - Request URL and path
 * - Headers (sanitized - Authorization/Cookie removed)
 * - Query parameters
 *
 * Usage:
 * ```typescript
 * export const POST = withSentry(async (req: NextRequest) => {
 *   // Your handler code
 *   return NextResponse.json({ success: true });
 * });
 * ```
 *
 * @param handler - Next.js API route handler
 * @returns Wrapped handler with Sentry error capture
 */
export function withSentry<T extends NextRequest>(
  handler: (req: T) => Promise<NextResponse>
): (req: T) => Promise<NextResponse> {
  return async (req: T) => {
    try {
      return await handler(req);
    } catch (error) {
      // Capture exception with request context
      Sentry.captureException(error, {
        contexts: {
          request: {
            method: req.method,
            url: req.url,
            headers: sanitizeHeaders(req.headers),
          },
        },
      });

      // Rethrow error to maintain normal Next.js error handling
      throw error;
    }
  };
}

/**
 * Sanitize request headers
 * Removes sensitive headers (Authorization, Cookie) before sending to Sentry
 */
function sanitizeHeaders(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

  headers.forEach((value, key) => {
    if (!sensitiveHeaders.includes(key.toLowerCase())) {
      sanitized[key] = value;
    }
  });

  return sanitized;
}
