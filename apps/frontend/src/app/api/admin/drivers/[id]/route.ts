import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { z } from 'zod';

// user_id is nullable (unlink) or a uuid (link) — never omitted, so a
// caller cannot accidentally send `{}` and no-op silently.
const linkDriverSchema = z.object({
  user_id: z.string().uuid().nullable(),
});

/**
 * PATCH /api/admin/drivers/[id]
 * Link (or unlink, with user_id: null) a public.users account to a driver —
 * spec-84 fase 1's minimal admin surface for drivers.user_id.
 *
 * Access: admin or operations_manager only (see route.ts for why not
 * super_admin too).
 *
 * The uniqueness itself is enforced by the DB (idx_drivers_user_id, global —
 * see the migration's comment for why not per-operator) and by
 * drivers_admin_write RLS (operator-scoped write). This handler adds two
 * checks the DB can't: a friendlier 404 when the target user isn't even in
 * the caller's operator (RLS would just silently match zero rows on the
 * final UPDATE, which reads as a confusing 404 already — but the target-user
 * check gives an explicit reason before wasting the write), and a friendly
 * 409 instead of a raw postgres error message for the unique violation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const body = await request.json();
    const validation = linkDriverSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }
    const { user_id } = validation.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: driver } = await sb
      .from('drivers')
      .select('id, operator_id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!driver) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Driver not found', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    if (user_id !== null) {
      const { data: targetUser } = await sb
        .from('users')
        .select('id')
        .eq('id', user_id)
        .eq('operator_id', driver.operator_id)
        .is('deleted_at', null)
        .single();

      if (!targetUser) {
        return NextResponse.json(
          { code: 'NOT_FOUND', message: 'User not found in this operator', timestamp: new Date().toISOString() },
          { status: 404 }
        );
      }
    }

    const { data: updated, error } = await sb
      .from('drivers')
      .update({ user_id })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id, user_id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { code: 'DUPLICATE_USER_LINK', message: 'This user is already linked to another driver', timestamp: new Date().toISOString() },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { code: 'UPDATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Unexpected error in PATCH /api/admin/drivers/[id]:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
