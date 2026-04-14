import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { z } from 'zod';

// RF-2: Zod schemas
const pickupLocationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  comuna: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

const createPickupPointSchema = z.object({
  name: z.string().min(1, 'Pickup point name is required'),
  code: z.string().min(1, 'Pickup point code is required'),
  tenant_client_id: z.string().uuid('Invalid client ID'),
  pickup_locations: z.array(pickupLocationSchema).min(1, 'At least one pickup location is required'),
});

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

    // Fetch pickup points with client name
    const { data: points, error } = await supabase
      .from('pickup_points')
      .select('*, tenant_clients(name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { code: 'FETCH_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    // Flatten client name
    const result = (points || []).map((p: Record<string, unknown>) => ({
      ...p,
      client_name: (p.tenant_clients as { name: string } | null)?.name ?? null,
      tenant_clients: undefined,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Unexpected error in GET /api/pickup-points:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    // RF-2: Zod validation
    const body = await request.json();
    const validation = createPickupPointSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const { name, code, tenant_client_id, pickup_locations } = validation.data;
    const operatorId = session.user.app_metadata?.claims?.operator_id;

    // Check code uniqueness within operator
    const { data: existingCode } = await supabase
      .from('pickup_points')
      .select('id')
      .eq('code', code.trim())
      .is('deleted_at', null);

    if (existingCode && existingCode.length > 0) {
      return NextResponse.json(
        { code: 'DUPLICATE_CODE', message: 'A pickup point with this code already exists', field: 'code', timestamp: new Date().toISOString() },
        { status: 409 }
      );
    }

    const { data: point, error } = await supabase
      .from('pickup_points')
      .insert({
        operator_id: operatorId,
        name: name.trim(),
        code: code.trim(),
        tenant_client_id,
        intake_method: 'manual',
        pickup_locations,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { code: 'CREATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json(point, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/pickup-points:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
