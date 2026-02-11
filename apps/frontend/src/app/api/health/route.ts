import { NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

// NOTE: This endpoint should be rate-limited in production (e.g., via middleware or Vercel Edge Config)
// Recommended: Max 60 requests/minute per IP to prevent DDoS attacks
// BetterStack uptime monitoring only needs to check every 3 minutes

export async function GET() {
  try {
    // Check database connectivity with simple query (not table-dependent)
    const supabase = await createSSRClient();

    // Use SELECT 1 for connection test (works even if operators table missing)
    const { error } = await supabase.rpc('pg_backend_pid');

    if (error) {
      console.error('[Health Check] Database connectivity failed:', error.message);
      return NextResponse.json(
        {
          status: 'unhealthy',
          error: 'Database connection failed',
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'dev',
      // Don't expose environment in production for security
      ...(process.env.NODE_ENV !== 'production' && {
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
      }),
    });
  } catch (error) {
    // Log full error details for debugging
    console.error('[Health Check] Unexpected error:', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
        // Include error details only in non-production
        ...(process.env.NODE_ENV !== 'production' && {
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
      { status: 500 }
    );
  }
}
