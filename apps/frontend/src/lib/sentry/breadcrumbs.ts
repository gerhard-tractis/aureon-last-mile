import * as Sentry from '@sentry/nextjs';

/**
 * Sentry Breadcrumb Helpers
 *
 * Convenience functions for adding custom breadcrumbs to Sentry error context.
 * Breadcrumbs provide a timeline of events leading up to an error.
 *
 * Automatic breadcrumbs (enabled by default):
 * - Console logs
 * - Network requests
 * - DOM events
 * - Navigation
 *
 * Use these helpers for critical business actions not automatically captured.
 */

/**
 * Add breadcrumb for user action
 *
 * @example
 * addActionBreadcrumb('Scanned barcode', { barcode: '12345' });
 * addActionBreadcrumb('Created manifest', { manifestId: 'M-001' });
 */
export function addActionBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'action',
    message,
    level: 'info',
    data,
  });
}

/**
 * Add breadcrumb for navigation/routing
 *
 * @example
 * addNavigationBreadcrumb('/dashboard', { from: '/login' });
 */
export function addNavigationBreadcrumb(to: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: `Navigated to ${to}`,
    level: 'info',
    data,
  });
}

/**
 * Add breadcrumb for API calls
 *
 * @example
 * addAPIBreadcrumb('POST /api/orders', { status: 201, duration: 150 });
 */
export function addAPIBreadcrumb(endpoint: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'api',
    message: endpoint,
    level: 'info',
    data,
  });
}

/**
 * Add breadcrumb for state changes
 *
 * @example
 * addStateBreadcrumb('User role changed', { from: 'driver', to: 'admin' });
 */
export function addStateBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'state',
    message,
    level: 'info',
    data,
  });
}

/**
 * Add breadcrumb for errors (non-fatal)
 *
 * @example
 * addErrorBreadcrumb('Validation failed', { field: 'email', error: 'Invalid format' });
 */
export function addErrorBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'error',
    message,
    level: 'error',
    data,
  });
}

/**
 * Add breadcrumb for warnings
 *
 * @example
 * addWarningBreadcrumb('Approaching quota limit', { usage: '90%' });
 */
export function addWarningBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'warning',
    message,
    level: 'warning',
    data,
  });
}
