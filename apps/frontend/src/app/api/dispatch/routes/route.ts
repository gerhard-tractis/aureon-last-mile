import { createSSRClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) {
      return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });
    }

    // Parse body — order_ids is optional
    let orderIds: string[] = [];
    try {
      const body = await req.json();
      if (Array.isArray(body?.order_ids)) orderIds = body.order_ids as string[];
    } catch {
      // empty or non-JSON body — treat as no order_ids
    }

    if (orderIds.length === 0) {
      return createEmptyDraft(supabase, operatorId);
    }

    // 1. Validate ownership: all order_ids must belong to this operator
    const { data: validOrders, error: ownerErr } = await supabase
      .from('orders')
      .select('id')
      .in('id', orderIds)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);

    if (ownerErr) throw ownerErr;

    const validIds = new Set((validOrders ?? []).map((o: { id: string }) => o.id));
    const invalidIds = orderIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json({ code: 'INVALID_ORDER_IDS', invalid_ids: invalidIds }, { status: 400 });
    }

    // 2. Check none are already on an active route
    const { data: dispatches, error: checkErr } = await supabase
      .from('dispatches')
      .select('order_id, route:routes!dispatches_route_id_fkey(status)')
      .in('order_id', orderIds)
      .is('deleted_at', null);

    if (checkErr) throw checkErr;

    const ACTIVE = new Set(['draft', 'planned', 'in_progress']);
    const routedIds = (dispatches ?? [])
      .filter((d) => d.route != null && ACTIVE.has(d.route.status))
      .map((d) => d.order_id)
      .filter((id): id is string => id != null);

    if (routedIds.length > 0) {
      return NextResponse.json({ code: 'ORDERS_ALREADY_ROUTED', routed_ids: routedIds }, { status: 400 });
    }

    // 3. Atomically create route + dispatches via Postgres function
    const { data: route, error: createErr } = await supabase.rpc('create_seeded_route', {
      p_operator_id: operatorId,
      p_order_ids: orderIds,
    });

    if (createErr) throw createErr;

    return NextResponse.json(route, { status: 201 });
  } catch (err) {
    console.error('[dispatch/routes POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

async function createEmptyDraft(
  supabase: Awaited<ReturnType<typeof createSSRClient>>,
  operatorId: string,
) {
  const today = new Date().toISOString().split('T')[0];
  const draftExternalId = `draft_${crypto.randomUUID()}`;

  const { data: route, error } = await supabase
    .from('routes')
    .insert({
      operator_id: operatorId,
      provider: 'dispatchtrack',
      external_route_id: draftExternalId,
      route_date: today,
      status: 'draft',
      planned_stops: 0,
      completed_stops: 0,
    })
    .select('id, status, route_date, created_at')
    .single();

  if (error) throw error;
  return NextResponse.json(route, { status: 201 });
}
