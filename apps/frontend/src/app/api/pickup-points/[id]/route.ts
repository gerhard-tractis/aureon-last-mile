import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { z } from 'zod';

// RF-2: Zod schemas. All fields optional — see /api/pickup-points/route.ts
// for the full rationale (DB constraints relaxed in 20260428000005).
const pickupLocationSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  comuna: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

const updatePickupPointSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  tenant_client_id: z.string().uuid().optional(),
  pickup_locations: z.array(pickupLocationSchema).optional(),
  is_active: z.boolean().optional(),
});

export async function PUT(
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

    // RF-2: Zod validation
    const body = await request.json();
    const validation = updatePickupPointSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const hasUpdates = Object.values(validation.data).some((v) => v !== undefined);
    if (!hasUpdates) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'No fields to update', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    // RF-5: Check record exists before updating
    const { data: existing } = await supabase
      .from('pickup_points')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!existing) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Pickup point not found', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    // Trim helper: empty/whitespace-only → null (so DB stores NULL and the
    // unique (operator_id, code) constraint does not collide on empties).
    const trimToNull = (s?: string) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : null;
    };

    // If updating code with a non-empty value, check uniqueness excluding
    // the current record. NULL/empty codes are allowed to coexist.
    if (validation.data.code !== undefined) {
      const cleanCode = trimToNull(validation.data.code);
      if (cleanCode) {
        const { data: existingCode } = await supabase
          .from('pickup_points')
          .select('id')
          .eq('code', cleanCode)
          .neq('id', id)
          .is('deleted_at', null);
        if (existingCode && existingCode.length > 0) {
          return NextResponse.json(
            { code: 'DUPLICATE_CODE', message: 'A pickup point with this code already exists', field: 'code', timestamp: new Date().toISOString() },
            { status: 409 }
          );
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (validation.data.name !== undefined) updates.name = trimToNull(validation.data.name);
    if (validation.data.code !== undefined) updates.code = trimToNull(validation.data.code);
    if (validation.data.tenant_client_id !== undefined) updates.tenant_client_id = validation.data.tenant_client_id || null;
    if (validation.data.pickup_locations !== undefined) updates.pickup_locations = validation.data.pickup_locations;
    if (validation.data.is_active !== undefined) updates.is_active = validation.data.is_active;

    const { data: point, error } = await supabase
      .from('pickup_points')
      .update(updates)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { code: 'UPDATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json(point);
  } catch (error) {
    console.error('Unexpected error in PUT /api/pickup-points/[id]:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
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
    if (userRole !== 'admin') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Only admins can delete pickup points', timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }

    // Soft delete
    const { error } = await supabase
      .from('pickup_points')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) {
      return NextResponse.json(
        { code: 'DELETE_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/pickup-points/[id]:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
