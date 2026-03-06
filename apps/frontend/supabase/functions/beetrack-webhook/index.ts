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
const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
const PROVIDER = 'dispatchtrack' as const;

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

  // Use substatus as failure_reason for failed dispatches
  const substatus = body.substatus as string | undefined;
  const substatusCode = body.substatus_code as string | undefined;
  const failureReason = status === 'failed' && substatus ? substatus : null;

  const dispatchRow = {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_dispatch_id: String(dispatchId),
    external_route_id: routeId != null ? String(routeId) : null,
    order_id: orderId,
    status,
    substatus: substatus ?? null,
    substatus_code: substatusCode ?? null,
    planned_sequence: (body.position as number) ?? null,
    estimated_at: (body.estimated_at as string) ?? null,
    arrived_at: (body.arrived_at as string) ?? null,
    completed_at: (body.time_of_management as string) ?? null,
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

  // Upsert fleet vehicle (if truck present)
  const truck = body.truck as string | undefined;
  const vehicleType = body.vehicle_type as string | undefined;
  let vehicleId: string | null = null;
  if (truck) {
    vehicleId = await upsertFleetVehicle(supabase, truck, vehicleType);
  }

  const routeRow = {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_route_id: externalRouteId,
    route_date: body.date as string,
    driver_name: (body.truck_driver as string) ?? null,
    vehicle_id: vehicleId,
    status: routeStatus,
    start_time: (body.started_at as string) ?? null,
    end_time: (body.ended_at as string) ?? null,
    total_km: (body.kpi_distance as number) ?? null,
    raw_data: body,
  };

  const { data: upsertedRoute, error } = await supabase
    .from('routes')
    .upsert(routeRow, {
      onConflict: 'operator_id,provider,external_route_id',
      ignoreDuplicates: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`beetrack-webhook: route upsert failed`, error);
    return json({ ok: false, error: error.message }, 500);
  }

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
): Promise<string | null> {
  const vehicleRow = {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_vehicle_id: externalVehicleId,
    vehicle_type: vehicleType ?? null,
    raw_data: {},
  };

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
