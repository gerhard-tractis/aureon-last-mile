/**
 * IP Address Utilities
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Extracts client IP address from Next.js request headers
 * Used for audit logging and security tracking
 */

import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Extract IP address from request headers
 *
 * Priority order:
 * 1. X-Forwarded-For (proxy/load balancer)
 * 2. X-Real-IP (nginx proxy)
 * 3. CF-Connecting-IP (Cloudflare)
 * 4. req.ip (direct connection)
 *
 * @param request - Next.js request object
 * @returns IP address string or 'unknown' if not found
 */
export function getClientIpAddress(request: NextRequest): string {
  // Try X-Forwarded-For (can contain multiple IPs, first is client)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips[0]) {
      return ips[0];
    }
  }

  // Try X-Real-IP (nginx proxy)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Try CF-Connecting-IP (Cloudflare)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  // Fallback to 'unknown' if no IP found
  return 'unknown';
}

/**
 * Set IP address in Supabase session for trigger access
 *
 * IMPORTANT: This must be called before any database operations
 * that should be logged by audit triggers.
 *
 * Usage in API routes:
 * ```typescript
 * const ipAddress = getClientIpAddress(request);
 * await setSupabaseSessionIp(supabase, ipAddress);
 * // Now perform database operations...
 * ```
 *
 * @param supabase - Supabase client
 * @param ipAddress - IP address to set
 */
export async function setSupabaseSessionIp(
  supabase: SupabaseClient,
  ipAddress: string
): Promise<void> {
  try {
    // Set session variable for audit trigger access
    // This uses PostgreSQL's SET LOCAL which is scoped to the current transaction
    await supabase.rpc('set_config', {
      setting_name: 'app.request_ip',
      setting_value: ipAddress,
      is_local: true
    });
  } catch (error) {
    // Log error but don't fail - audit logging should not break operations
    console.warn('Failed to set session IP for audit logging:', error);
  }
}

/**
 * Helper function to create the PostgreSQL set_config function
 * This should be added to migrations if not exists:
 *
 * CREATE OR REPLACE FUNCTION public.set_config(
 *   setting_name text,
 *   setting_value text,
 *   is_local boolean DEFAULT true
 * )
 * RETURNS text
 * LANGUAGE plpgsql
 * SECURITY DEFINER
 * AS $$
 * BEGIN
 *   PERFORM set_config(setting_name, setting_value, is_local);
 *   RETURN setting_value;
 * END;
 * $$;
 */
