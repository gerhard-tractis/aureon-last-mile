import { createSSRClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { ACTIVE_ROUTE_STATUSES } from '@/lib/dispatch/types';

/** ISO calendar date, the shape `routes.route_date` stores. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

    // Parse body — order_ids and route_date are both optional
    let orderIds: string[] = [];
    let routeDate: string | null = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.order_ids)) orderIds = body.order_ids as string[];
      if (body?.route_date != null) {
        // Validated here rather than trusted: an unparseable date reaching the
        // DB is a 500, and a plausible-but-wrong one (01-09-2026) would create
        // a route dated in the past without complaint.
        if (typeof body.route_date !== 'string' || !ISO_DATE.test(body.route_date)) {
          return NextResponse.json({ code: 'VALIDATION_ERROR', field: 'route_date' }, { status: 400 });
        }
        routeDate = body.route_date;
      }
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

    // spec-70 widened the lifecycle. This set previously held only
    // draft/planned/in_progress, so an order on a route that was mid-load or
    // already at DispatchTrack passed the guard and could be planned onto a
    // second truck.
    const ACTIVE = new Set<string>(ACTIVE_ROUTE_STATUSES);
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
      // NULL means "today", decided by the database rather than by whichever
      // timezone the server happens to be in.
      p_route_date: routeDate,
    });

    if (createErr) throw createErr;

    // spec-71 Decision 8: a seeded route reaches `planned` immediately, so it
    // gets a best-effort load-position assignment right here. No position
    // free is not an error — the route is still returned as created; it is
    // simply left with load_position_id NULL until one frees up.
    const createdRoute = route as { id?: string } | null;
    // Built fresh rather than mutated onto `createdRoute` — the RPC result is
    // someone else's object; patching a field onto it in place is surprising
    // for any future reader who holds onto `route` expecting exactly what
    // create_seeded_route returned.
    let responseBody: unknown = route;
    if (createdRoute?.id) {
      try {
        const { data: assignedPositionId, error: assignError } = await supabase.rpc('assign_load_position', {
          p_route_id: createdRoute.id,
          p_operator_id: operatorId,
          p_user_id: session.user.id,
        });
        if (assignError) {
          console.error('[dispatch/routes POST] assign_load_position failed', assignError);
        } else if (assignedPositionId) {
          responseBody = { ...createdRoute, load_position_id: assignedPositionId };
          // Audit log — actual audit_logs schema: operator_id, user_id,
          // action, resource_type, resource_id, changes_json, ip_address.
          // Mirrors the shape used in [id]/dispatch/route.ts.
          await supabase.from('audit_logs').insert({
            operator_id: operatorId,
            user_id: session.user.id,
            action: 'assign_load_position',
            resource_type: 'routes',
            resource_id: createdRoute.id,
            changes_json: { load_position_id: assignedPositionId },
            ip_address: 'unknown',
          }).then(() => null, () => null);
        }
      } catch (assignErr) {
        // Best-effort (Decision 8): never fail route creation over assignment.
        console.error('[dispatch/routes POST] assign_load_position threw', assignErr);
      }
    }

    return NextResponse.json(responseBody, { status: 201 });
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
