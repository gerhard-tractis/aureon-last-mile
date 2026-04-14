import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils/slugify';
import { z } from 'zod';

// RF-2: Zod schema for validation
const createClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(100),
});

// RF-3: Note: RLS allows all authenticated writes per operator; role check is enforced here at API level

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

    // Fetch clients with pickup point count — RLS filters by operator_id
    const { data: clients, error } = await supabase
      .from('tenant_clients')
      .select('*, pickup_points(count)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { code: 'FETCH_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    // Flatten pickup point count
    const result = (clients || []).map((c: Record<string, unknown>) => ({
      ...c,
      pickup_point_count: Array.isArray(c.pickup_points) ? (c.pickup_points[0] as { count: number })?.count ?? 0 : 0,
      pickup_points: undefined,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Unexpected error in GET /api/clients:', error);
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
    const validation = createClientSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const { name } = validation.data;
    const operatorId = session.user.app_metadata?.claims?.operator_id;
    let slug = slugify(name.trim());

    // RF-4: Slug collision check includes soft-deleted records (to match DB UNIQUE constraint on operator_id+slug)
    const { data: existing } = await supabase
      .from('tenant_clients')
      .select('slug')
      .eq('slug', slug);

    if (existing && existing.length > 0) {
      let suffix = 2;
      let candidateSlug = `${slug}-${suffix}`;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: check } = await supabase
          .from('tenant_clients')
          .select('slug')
          .eq('slug', candidateSlug);
        if (!check || check.length === 0) break;
        suffix++;
        candidateSlug = `${slug}-${suffix}`;
      }
      slug = candidateSlug;
    }

    const { data: client, error } = await supabase
      .from('tenant_clients')
      .insert({
        operator_id: operatorId,
        name: name.trim(),
        slug,
        is_active: true,
        connector_config: {},
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { code: 'CREATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/clients:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
