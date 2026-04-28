import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { z } from 'zod';

// RF-2: Zod schemas. All fields optional — operators may save partial
// records and fill in the rest later. DB constraints were relaxed in
// 20260428000005.
const pickupLocationSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  comuna: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

const createPickupPointSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  tenant_client_id: z.string().uuid('Invalid client ID').optional(),
  pickup_locations: z.array(pickupLocationSchema).optional(),
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

    // Trim to a non-empty string or undefined — empty/whitespace-only values
    // are stored as NULL so the unique (operator_id, code) constraint does
    // not collide on empty codes.
    const trimmed = (s?: string) => {
      const t = s?.trim();
      return t && t.length > 0 ? t : undefined;
    };
    const cleanName = trimmed(name);
    const cleanCode = trimmed(code);

    // Only check uniqueness when a non-empty code is provided. Multiple
    // pickup points without a code may coexist (NULL ≠ NULL in PG).
    if (cleanCode) {
      const { data: existingCode } = await supabase
        .from('pickup_points')
        .select('id')
        .eq('code', cleanCode)
        .is('deleted_at', null);

      if (existingCode && existingCode.length > 0) {
        return NextResponse.json(
          { code: 'DUPLICATE_CODE', message: 'A pickup point with this code already exists', field: 'code', timestamp: new Date().toISOString() },
          { status: 409 }
        );
      }
    }

    // Cast insert payload through `any` — generated Supabase types still
    // mark name/code/tenant_client_id as NOT NULL (regenerating types is a
    // separate task), but the migration 20260428000005 has dropped those
    // constraints at the column level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: any = {
      operator_id: operatorId,
      name: cleanName ?? null,
      code: cleanCode ?? null,
      tenant_client_id: tenant_client_id ?? null,
      intake_method: 'manual',
      pickup_locations: pickup_locations ?? [],
      is_active: true,
    };
    const { data: point, error } = await supabase
      .from('pickup_points')
      .insert(insertPayload)
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
