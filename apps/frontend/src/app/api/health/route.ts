import { NextResponse } from 'next/server';
import { createServerAdminClient } from '@/lib/supabase/serverAdminClient';

// NOTE: This endpoint should be rate-limited in production (e.g., via middleware or Vercel Edge Config)
// to prevent abuse. Recommended: 60 requests per minute per IP.
// BetterStack uptime monitoring only needs to check every 5 minutes.

/**
 * Health Check Endpoint
 * GET /api/health
 *
 * Returns application health status for uptime monitoring (BetterStack, Pingdom, etc.)
 *
 * Checks:
 * - Database connectivity (Supabase query)
 *
 * Note: Memory check removed — Vercel serverless functions have small initial heap sizes
 * (often 30-50MB). heapUsed/heapTotal ratio routinely exceeds 80% without any real problem
 * because Node.js expands the heap on demand. This caused persistent false 503 alerts.
 *
 * Response:
 * - 200: All checks passed (healthy)
 * - 503: One or more checks failed (unhealthy)
 *
 * Disable caching to ensure real-time health status
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {
    database: false,
    timestamp: new Date().toISOString(),
  };

  try {
    // Check: Database connectivity (using service role to bypass RLS)
    const supabase = await createServerAdminClient();
    const { error } = await supabase.from('operators').select('id').limit(1);
    checks.database = !error;

    const isHealthy = checks.database;

    // Include memory info for observability (not used for health determination)
    const memUsage = process.memoryUsage();

    return NextResponse.json(
      {
        status: isHealthy ? 'healthy' : 'unhealthy',
        checks,
        memory: {
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        },
      },
      { status: isHealthy ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        checks,
      },
      { status: 503 }
    );
  }
}
