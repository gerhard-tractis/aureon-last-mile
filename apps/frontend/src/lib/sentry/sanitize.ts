import type { Event, EventHint } from '@sentry/nextjs';

/**
 * Sanitize and Sample Sentry Event
 *
 * 1. Removes sensitive data from error events (GDPR/privacy compliance)
 * 2. Applies error sampling to manage Sentry quota (5,000 errors/month free tier)
 *
 * Sanitization Rules:
 * - Remove sensitive headers (Authorization, Cookie, API keys)
 * - Redact password/token/secret fields in request data
 * - Mask user email (show first 3 chars + domain)
 *
 * Sampling Rules (Task 7.1):
 * - Fatal/Error events: 100% captured (high priority)
 * - Warning events: 50% captured (medium priority)
 * - Info/Debug events: 50% captured (low priority)
 * - Fail-open: Return event even if processing fails
 *
 * @param event - Sentry event to process
 * @param hint - Event hint (unused, required by Sentry beforeSend signature)
 * @returns Processed event, null (drop event), or original event if processing fails
 */
export function sanitizeEvent(event: Event, _hint: EventHint): Event | null {
  try {
    // Apply sampling logic first (before expensive sanitization)
    const shouldSample = applyErrorSampling(event);
    if (!shouldSample) {
      return null; // Drop event
    }

    // Clone event to avoid mutating original
    const sanitized = { ...event };

    // Sanitize request headers
    if (sanitized.request?.headers) {
      sanitized.request = { ...sanitized.request };
      sanitized.request.headers = { ...sanitized.request.headers };

      const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
      sensitiveHeaders.forEach((header) => {
        delete sanitized.request!.headers![header];
        delete sanitized.request!.headers![header.toLowerCase()];
      });
    }

    // Sanitize request data (body/query params)
    if (sanitized.request?.data) {
      sanitized.request = { ...sanitized.request };
      sanitized.request.data = redactSensitiveFields(sanitized.request.data);
    }

    // Mask user email
    if (sanitized.user?.email) {
      const email = sanitized.user.email;
      sanitized.user = { ...sanitized.user };
      sanitized.user.email = maskEmail(email);
    }

    return sanitized;
  } catch (error) {
    // Fail-open: Send unsanitized event rather than dropping it
    console.error('[Sentry] Event processing failed:', error);
    return event;
  }
}

/**
 * Apply error sampling to manage Sentry quota
 * Returns true if event should be sent, false to drop
 *
 * Sampling Strategy:
 * - Fatal/Error: 100% (always send critical errors)
 * - Warning: 50% (sample to reduce noise)
 * - Info/Debug: 50% (sample to reduce noise)
 */
function applyErrorSampling(event: Event): boolean {
  const level = event.level || 'error';

  // Always capture fatal and error events (high priority)
  if (level === 'fatal' || level === 'error') {
    return true;
  }

  // Sample 50% of warnings and info/debug events (low priority)
  // This reduces quota usage while maintaining visibility into issues
  return Math.random() < 0.5;
}

/**
 * Recursively redact sensitive fields in object
 * @param data - Object to sanitize
 * @returns Sanitized object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function redactSensitiveFields(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveFields);
  }

  const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'apiKey'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveFields.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveFields(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Mask email address
 * Shows first 3 characters + domain for debuggability
 *
 * @example
 * maskEmail('john.doe@example.com') // 'joh***@example.com'
 * maskEmail('ab@example.com') // 'ab***@example.com'
 */
function maskEmail(email: string): string {
  const match = email.match(/^(.{1,3}).*(@.+)$/);
  if (match) {
    return `${match[1]}***${match[2]}`;
  }
  return email; // Fallback if email format is unexpected
}
