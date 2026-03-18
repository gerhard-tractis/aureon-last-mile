import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// DispatchTrack status codes → dispatch_status_enum
// Field mapping mirrors the beetrack-webhook handler (same provider API)
const STATUS_MAP: Record<number, 'pending' | 'delivered' | 'failed' | 'partial'> = {
  1: 'pending',
  2: 'delivered',
  3: 'failed',
  4: 'partial',
};

const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
const PROVIDER = 'dispatchtrack' as const;
const DT_BASE_URL = 'https://transportesmusan.dispatchtrack.com';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const apiKey = Deno.env.get('DISPATCHTRACK_API_KEY');
  if (!apiKey) {
    return json({ ok: false, error: 'DISPATCHTRACK_API_KEY not configured' }, 500);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Step 1: Query today's in_progress routes
  const today = new Date().toISOString().split('T')[0];
  const { data: routes, error: routesError } = await supabase
    .from('routes')
    .select('id, external_route_id')
    .eq('operator_id', MUSAN_OPERATOR_ID)
    .eq('provider', PROVIDER)
    .eq('status', 'in_progress')
    .eq('route_date', today)
    .is('deleted_at', null);

  if (routesError) {
    console.error('route-poll: failed to fetch active routes', routesError);
    return json({ ok: false, error: routesError.message }, 500);
  }

  if (!routes || routes.length === 0) {
    console.log(`route-poll: no active routes for ${today}`);
    return json({ ok: true, message: 'No active routes today', polled: 0 });
  }

  console.log(`route-poll: polling ${routes.length} active routes for ${today}`);

  let polled = 0;
  let errors = 0;

  for (const route of routes) {
    try {
      // Step 2: Call DispatchTrack REST API for each route
      const res = await fetch(
        `${DT_BASE_URL}/api/external/v1/routes/${route.external_route_id}`,
        { headers: { 'X-AUTH-TOKEN': apiKey } },
      );

      if (!res.ok) {
        console.warn(`route-poll: API ${res.status} for route ${route.external_route_id}`);
        errors++;
        continue;
      }

      const data = await res.json() as Record<string, unknown>;

      // Update route status if changed (started/ended booleans from API)
      const started = data.started as boolean | undefined;
      const ended = data.ended as boolean | undefined;
      let routeStatus: 'planned' | 'in_progress' | 'completed' = 'in_progress';
      if (started && ended) routeStatus = 'completed';
      else if (started) routeStatus = 'in_progress';

      await supabase
        .from('routes')
        .update({ status: routeStatus })
        .eq('id', route.id);

      // Step 3: Upsert dispatches with updated ETAs and statuses
      // NOTE: REST API returns dispatches in same shape as webhook payload
      const dispatches = (data.dispatches as Record<string, unknown>[] | undefined) ?? [];

      for (const d of dispatches) {
        const dispatchId = d.dispatch_id as number | undefined;
        if (!dispatchId) continue;

        const statusCode = d.status as number | undefined;
        const status = statusCode !== undefined ? STATUS_MAP[statusCode] : undefined;
        if (!status) continue;

        const completedAt =
          (d.time_of_management as string) ??
          (d.arrived_at as string) ??
          null;

        const { error: upsertError } = await supabase
          .from('dispatches')
          .update({
            status,
            planned_sequence: (d.position as number) ?? null,
            estimated_at: (d.estimated_at as string) ?? null,
            arrived_at: (d.arrived_at as string) ?? null,
            completed_at: completedAt,
            latitude: (d.management_latitude as number) ?? null,
            longitude: (d.management_longitude as number) ?? null,
          })
          .eq('operator_id', MUSAN_OPERATOR_ID)
          .eq('provider', PROVIDER)
          .eq('external_dispatch_id', String(dispatchId));

        if (upsertError) {
          console.warn(
            `route-poll: dispatch update failed for ${dispatchId}:`,
            upsertError.message,
          );
        }
      }

      polled++;
      console.log(
        `route-poll: route ${route.external_route_id} → ${routeStatus}, ${dispatches.length} dispatches updated`,
      );
    } catch (err) {
      console.error(`route-poll: error for route ${route.external_route_id}:`, err);
      errors++;
    }

    // Rate limit: 1 req/sec (DispatchTrack limit)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return json({ ok: true, polled, errors, total: routes.length });
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
