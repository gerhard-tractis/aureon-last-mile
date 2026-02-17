import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { addActionBreadcrumb, addErrorBreadcrumb } from '@/lib/sentry/breadcrumbs';

/**
 * Test Sentry Error Capture
 * GET /api/test-sentry
 *
 * Triggers a test error to verify Sentry monitoring pipeline:
 * - Error capture and reporting
 * - User context enrichment
 * - Breadcrumb tracking
 * - Alert notifications (Slack + Email)
 *
 * IMPORTANT: This is a test endpoint. Remove or disable in production after testing.
 *
 * Query params:
 * - key: Required secret key to prevent abuse (set SENTRY_TEST_KEY in env)
 *
 * Example: /api/test-sentry?key=your-secret-key
 *
 * Story: 1.8 - Set Up Monitoring and Alerting
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  // Security: Require secret key to prevent abuse
  const expectedKey = process.env.SENTRY_TEST_KEY || 'test-sentry-monitoring';
  if (key !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid or missing test key' },
      { status: 403 }
    );
  }

  try {
    // Add breadcrumbs to verify they're captured
    addActionBreadcrumb('Test: Starting Sentry error test', {
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    });

    addErrorBreadcrumb('Test: About to throw test error', {
      testId: 'sentry-monitoring-test',
      severity: 'error',
    });

    // Add custom context
    Sentry.setContext('test_context', {
      testType: 'monitoring-verification',
      triggeredBy: 'Story 1.8 completion test',
      expectedBehavior: 'Should send alert to Slack + Email',
    });

    // Set tags for filtering
    Sentry.setTag('test_error', 'true');
    Sentry.setTag('story', '1.8');

    // Throw test error
    throw new Error('🧪 TEST ERROR: Sentry Monitoring Verification - This is a test error to verify alerts work correctly');

  } catch (error) {
    // Capture the error with Sentry
    const eventId = Sentry.captureException(error, {
      level: 'error',
      tags: {
        test: 'true',
        endpoint: '/api/test-sentry',
      },
      contexts: {
        test: {
          purpose: 'Verify Sentry monitoring pipeline',
          expected_alerts: ['Slack notification', 'Email notification'],
          story: '1.8',
        },
      },
    });

    // Return response with event ID
    return NextResponse.json(
      {
        success: true,
        message: 'Test error captured by Sentry',
        eventId,
        instructions: [
          '1. Check Sentry dashboard: https://sentry.io/organizations/tractis/issues/',
          '2. Check Slack #alertas-sentry for notification',
          '3. Check your email for alert',
          '4. Error should include user context (if authenticated)',
          '5. Error should include breadcrumbs',
        ],
        nextSteps: 'If alerts received, Story 1.8 monitoring is working correctly! 🎉',
      },
      { status: 200 }
    );
  }
}

