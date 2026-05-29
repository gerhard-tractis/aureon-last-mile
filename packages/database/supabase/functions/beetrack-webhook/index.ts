import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// DispatchTrack webhook `status` field (number) → dispatch_status_enum
// 1 = Pending, 2 = Delivered, 3 = Failed/Rejected, 4 = Partial delivery
const STATUS_MAP: Record<number, 'pending' | 'delivered' | 'failed' | 'partial'> = {
  1: 'pending',
  2: 'delivered',
  3: 'failed',
  4: 'partial',
};

// Musan operator_id (hardcoded — single operator account)
export const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
export const PROVIDER = 'dispatchtrack' as const;

/**
 * Build the row used by handleDispatch to upsert the parent route when a
 * dispatch event arrives carrying a route_id we don't yet have a row for.
 *
 * Discovery via dispatch event only proves the route exists and is live —
 * detailed status (start/end times, total_km) lands when the route-resource
 * webhook fires next and falls into handleRoute's update path.
 */
export function buildRouteUpsertRow(
  routeId: number | string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_route_id: String(routeId),
    status: 'in_progress',
    route_date: new Date().toISOString().split('T')[0],
    driver_name: (body.truck_driver as string) ?? null,
    raw_data: { discovered_via: 'dispatch_webhook' },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Validate shared secret
  const secret = Deno.env.get('BEETRACK_WEBHOOK_SECRET');
  if (secret) {
    const incoming = req.headers.get('X-Webhook-Secret') ?? req.headers.get('x-webhook-secret');
    if (incoming !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const resource = body.resource as string | undefined;
  const event = body.event as string | undefined;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    switch (resource) {
      case 'dispatch':
        return await handleDispatch(supabase, body);
      case 'route':
        return await handleRoute(supabase, body);
      case 'dispatch_guide':
        console.log(`beetrack-webhook: dispatch_guide/${event} — skipping (no DB write)`);
        return json({ ok: true, skipped: 'dispatch_guide' });
      case 'review':
        console.log(`beetrack-webhook: review/${event} — skipping (no DB write)`);
        return json({ ok: true, skipped: 'review' });
      default:
        console.log(`beetrack-webhook: unknown resource=${resource}/${event} — skipping`);
        return json({ ok: true, skipped: `unknown resource: ${resource}` });
    }
  } catch (err) {
    console.error(`beetrack-webhook: ${resource}/${event} error:`, err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

// ── Dispatch Handler ─────────────────────────────────────────────────
async function handleDispatch(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const dispatchId = body.dispatch_id as number | undefined;
  const routeId = body.route_id as number | undefined;
  const identifier = body.identifier as string | undefined;
  const statusCode = body.status as number | undefined;

  if (!dispatchId) {
    console.warn('beetrack-webhook: dispatch missing dispatch_id, skipping');
    return json({ ok: true, skipped: 'no dispatch_id' });
  }

  const status = statusCode !== undefined ? STATUS_MAP[statusCode] : undefined;
  if (!status) {
    console.warn(`beetrack-webhook: dispatch/${body.event} unknown status=${statusCode}`);
    return json({ ok: true, skipped: `unknown status: ${statusCode}` });
  }

  // Upsert fleet vehicle (if truck_identifier present)
  const truckIdentifier = body.truck_identifier as string | undefined;
  const truckType = body.truck_type as string | undefined;
  let vehicleId: string | null = null;
  if (truckIdentifier) {
    vehicleId = await upsertFleetVehicle(supabase, truckIdentifier, truckType);
  }

  // Attempt order lookup (non-blocking)
  let orderId: string | null = null;
  if (identifier) {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('order_number', identifier)
      .eq('operator_id', MUSAN_OPERATOR_ID)
      .maybeSingle();
    orderId = order?.id ?? null;
  }

  // Discover the parent route from the dispatch payload. DispatchTrack can
  // create routes directly in its UI (truck grouping), and those never reach
  // handleRoute's "managed by this system" branch — leaving dispatches
  // orphaned with route_id=null and routes empty. Upsert here so the route
  // exists for every consumer (poller, Hojas listing, agents) by the time
  // the dispatch row lands. Idempotent on (operator_id,provider,external_route_id).
  let parentRouteId: string | null = null;
  if (routeId != null) {
    const { data: routeRow, error: routeErr } = await supabase
      .from('routes')
      .upsert(buildRouteUpsertRow(routeId, body), {
        onConflict: 'operator_id,provider,external_route_id',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();
    if (routeErr) {
      // Non-fatal: surface the failure but keep going so the dispatch still
      // lands. Next event for the same route will retry the route upsert.
      console.warn(`beetrack-webhook: route upsert failed for ${routeId}`, routeErr);
    } else {
      parentRouteId = routeRow?.id ?? null;
    }
  }

  // Use substatus as failure_reason for failed dispatches
  const substatus = body.substatus as string | undefined;
  const substatusCode = body.substatus_code as string | undefined;
  const failureReason = status === 'failed' && substatus ? substatus : null;

  const dispatchRow = {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_dispatch_id: String(dispatchId),
    external_route_id: routeId != null ? String(routeId) : null,
    route_id: parentRouteId,
    order_id: orderId,
    status,
    substatus: substatus ?? null,
    substatus_code: substatusCode ?? null,
    planned_sequence: (body.position as number) ?? null,
    estimated_at: (body.estimated_at as string) ?? null,
    arrived_at: (body.arrived_at as string) ?? null,
    completed_at: (body.time_of_management as string) ?? (body.arrived_at as string) ?? null,
    failure_reason: failureReason,
    is_pickup: (body.is_pickup as boolean) ?? false,
    latitude: (body.management_latitude as number) ?? null,
    longitude: (body.management_longitude as number) ?? null,
    raw_data: body,
  };

  const { error } = await supabase
    .from('dispatches')
    .upsert(dispatchRow, {
      onConflict: 'operator_id,provider,external_dispatch_id',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error(`beetrack-webhook: dispatch upsert failed`, error);
    return json({ ok: false, error: error.message }, 500);
  }

  // Update order status for terminal dispatches (AC1-AC5)
  if (orderId && (status === 'delivered' || status === 'failed' || status === 'partial')) {
    const orderStatus = status === 'delivered' ? 'entregado' : 'cancelado';
    let statusDetail: string;
    if (status === 'delivered') {
      statusDetail = `Delivered via DispatchTrack dispatch #${dispatchId}`;
    } else if (status === 'partial') {
      statusDetail = `Partial delivery via DispatchTrack dispatch #${dispatchId}${substatus ? ` — ${substatus}` : ''}`;
    } else {
      statusDetail = substatus || `Failed via DispatchTrack dispatch #${dispatchId}`;
    }

    const { error: orderError } = await supabase
      .from('orders')
      .update({ status: orderStatus, status_detail: statusDetail })
      .eq('id', orderId)
      .neq('status', 'entregado'); // Never downgrade from entregado

    if (orderError) {
      console.warn(`beetrack-webhook: order status update failed for ${orderId}`, orderError);
      // Non-blocking — dispatch is already saved
    } else {
      console.log(`beetrack-webhook: order ${orderId} status → ${orderStatus}`);
    }
  } else if (!orderId && identifier) {
    console.warn(`beetrack-webhook: no order found for identifier=${identifier}, skipping status update`);
  }

  console.log(`beetrack-webhook: dispatch/${body.event} dispatch_id=${dispatchId} status=${status}`);
  return json({ ok: true, resource: 'dispatch', dispatch_id: dispatchId, status });
}

// ── Route Handler ────────────────────────────────────────────────────
async function handleRoute(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const routeIdRaw = body.route as number | undefined;
  if (!routeIdRaw) {
    console.warn('beetrack-webhook: route missing route id, skipping');
    return json({ ok: true, skipped: 'no route id' });
  }

  const externalRouteId = String(routeIdRaw);
  const started = body.started as boolean | undefined;
  const ended = body.ended as boolean | undefined;

  // Derive status from started/ended booleans
  let routeStatus: 'planned' | 'in_progress' | 'completed' = 'planned';
  if (started && ended) routeStatus = 'completed';
  else if (started) routeStatus = 'in_progress';

  // Upsert fleet vehicle (if truck present), include driver_name from route payload
  const truck = body.truck as string | undefined;
  const vehicleType = body.vehicle_type as string | undefined;
  const truckDriver = body.truck_driver as string | undefined;
  let vehicleId: string | null = null;
  if (truck) {
    vehicleId = await upsertFleetVehicle(supabase, truck, vehicleType, truckDriver);
  }

  // Only update routes that originated in our system. Routes created directly
  // in DispatchTrack will not have a matching local record — skip them.
  const { data: existingRoute } = await supabase
    .from('routes')
    .select('id')
    .eq('operator_id', MUSAN_OPERATOR_ID)
    .eq('provider', PROVIDER)
    .eq('external_route_id', externalRouteId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!existingRoute) {
    console.log(`beetrack-webhook: route/${body.event} route=${externalRouteId} — not managed by this system, skipping`);
    return json({ ok: true, skipped: 'route not managed by this system' });
  }

  const { error } = await supabase
    .from('routes')
    .update({
      driver_name: (body.truck_driver as string) ?? null,
      vehicle_id: vehicleId,
      status: routeStatus,
      start_time: (body.started_at as string) ?? null,
      end_time: (body.ended_at as string) ?? null,
      total_km: (body.kpi_distance as number) ?? null,
      raw_data: body,
    })
    .eq('id', existingRoute.id)
    .eq('operator_id', MUSAN_OPERATOR_ID);

  if (error) {
    console.error(`beetrack-webhook: route update failed`, error);
    return json({ ok: false, error: error.message }, 500);
  }

  const upsertedRoute = existingRoute;

  // Backfill: link dispatches that reference this route but have no route_id FK yet
  if (upsertedRoute?.id) {
    const { error: backfillError } = await supabase
      .from('dispatches')
      .update({ route_id: upsertedRoute.id })
      .eq('operator_id', MUSAN_OPERATOR_ID)
      .eq('provider', PROVIDER)
      .eq('external_route_id', externalRouteId)
      .is('route_id', null);

    if (backfillError) {
      console.warn(`beetrack-webhook: route backfill failed`, backfillError);
    }
  }

  console.log(`beetrack-webhook: route/${body.event} route=${externalRouteId} status=${routeStatus}`);
  return json({ ok: true, resource: 'route', route_id: externalRouteId, status: routeStatus });
}

// ── Fleet Vehicle Upsert ─────────────────────────────────────────────
async function upsertFleetVehicle(
  supabase: ReturnType<typeof createClient>,
  externalVehicleId: string,
  vehicleType?: string | null,
  driverName?: string | null,
): Promise<string | null> {
  const vehicleRow: Record<string, unknown> = {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_vehicle_id: externalVehicleId,
    vehicle_type: vehicleType ?? null,
    raw_data: {},
  };
  if (driverName) vehicleRow.driver_name = driverName;

  const { data, error } = await supabase
    .from('fleet_vehicles')
    .upsert(vehicleRow, {
      onConflict: 'operator_id,provider,external_vehicle_id',
      ignoreDuplicates: false,
    })
    .select('id')
    .single();

  if (error) {
    console.warn(`beetrack-webhook: fleet_vehicle upsert failed for ${externalVehicleId}`, error);
    return null;
  }

  return data?.id ?? null;
}

// ── Helpers ──────────────────────────────────────────────────────────
function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
