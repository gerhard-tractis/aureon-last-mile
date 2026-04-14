import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { z } from 'zod';

// RF-2: Zod schemas
const updateClientSchema = z.object({
  name: z.string().min(1, 'Client name cannot be empty').max(100).optional(),
  is_active: z.boolean().optional(),
});

// RF-3: Note: RLS allows all authenticated writes per operator; role check is enforced here at API level

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
    const validation = updateClientSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    if (validation.data.name === undefined && validation.data.is_active === undefined) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'No fields to update', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    // RF-5: Check record exists before updating
    const { data: existing } = await supabase
      .from('tenant_clients')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!existing) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Client not found', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (validation.data.name !== undefined) updates.name = validation.data.name.trim();
    if (validation.data.is_active !== undefined) updates.is_active = validation.data.is_active;

    const { data: client, error } = await supabase
      .from('tenant_clients')
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

    return NextResponse.json(client);
  } catch (error) {
    console.error('Unexpected error in PUT /api/clients/[id]:', error);
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
        { code: 'FORBIDDEN', message: 'Only admins can delete clients', timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }

    // Check for active pickup points
    const { data: activePoints } = await supabase
      .from('pickup_points')
      .select('id')
      .eq('tenant_client_id', id)
      .is('deleted_at', null)
      .eq('is_active', true);

    if (activePoints && activePoints.length > 0) {
      return NextResponse.json(
        { code: 'HAS_DEPENDENCIES', message: `Cannot delete client with ${activePoints.length} active pickup point(s). Deactivate or delete them first.`, timestamp: new Date().toISOString() },
        { status: 409 }
      );
    }

    // Soft delete
    const { error } = await supabase
      .from('tenant_clients')
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
    console.error('Unexpected error in DELETE /api/clients/[id]:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
