import { NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/drivers
 * List drivers for the caller's operator, with the linked public.users row
 * (if any) embedded — spec-84 fase 1.
 *
 * Access: admin or operations_manager only (same gate as /api/users and
 * /api/pickup-points; not the broader admin|operations_manager|super_admin
 * list /admin/page.tsx uses — a super_admin belongs to the internal Aureon
 * operator, a different tenant, and has no drivers of its own to manage
 * here).
 *
 * RLS: drivers_authenticated_read (20260318000005) filters to the caller's
 * own operator_id.
 *
 * `public.drivers` has no generated Supabase type (apps/frontend/src/lib/types.ts
 * has never been regenerated to include the agent-suite tables — same gap
 * spec-84 fase 1 documents for `assignments`/`generators`/etc.), so the
 * client is cast through `any` here, matching the existing precedent in
 * /api/pickup-points/route.ts for a similarly stale-typed column.
 */
export async function GET() {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }

    const userRole = session.user.app_metadata?.claims?.role;
    if (userRole !== 'admin' && userRole !== 'operations_manager') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: drivers, error } = await (supabase as any)
      .from('drivers')
      .select('id, operator_id, full_name, phone, rut, fleet_type, status, user_id, users(id, email, full_name)')
      .is('deleted_at', null)
      .order('full_name', { ascending: true });

    if (error) {
      return NextResponse.json(
        { code: 'FETCH_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json(drivers ?? []);
  } catch (error) {
    console.error('Unexpected error in GET /api/admin/drivers:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
