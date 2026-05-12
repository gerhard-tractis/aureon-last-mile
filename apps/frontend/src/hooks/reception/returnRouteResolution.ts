import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrderRouteLookup {
  /** external_route_id from the most-recent dispatch, falling back to routes.external_route_id. Null when no dispatch exists. */
  externalRouteId: string | null;
  /** routes.driver_name for the most-recent dispatch's route. Null when no route row matches. */
  driverName: string | null;
}

/**
 * For a set of order_ids, returns the most-recent dispatch's external_route_id
 * (and the route's driver_name) per order — in two queries instead of three.
 *
 * The packages → orders → dispatches → routes chain only needs `routes` for
 * `driver_name`; `dispatches.external_route_id` already carries the external
 * id directly. Older dispatch rows may have it null, so we fall back to the
 * routes table when needed.
 */
export async function resolveRoutesByOrder(
  supabase: SupabaseClient,
  operatorId: string,
  orderIds: readonly string[]
): Promise<Map<string, OrderRouteLookup>> {
  const result = new Map<string, OrderRouteLookup>();
  if (orderIds.length === 0) return result;

  const { data: dispatches, error: dispErr } = await supabase
    .from('dispatches')
    .select('order_id, route_id, external_route_id, created_at')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds as string[])
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (dispErr) throw dispErr;

  type Dispatch = {
    order_id: string;
    route_id: string | null;
    external_route_id: string | null;
  };

  const latestByOrder = new Map<string, Dispatch>();
  for (const d of (dispatches ?? []) as Dispatch[]) {
    if (!latestByOrder.has(d.order_id)) latestByOrder.set(d.order_id, d);
  }

  const routeIds = [
    ...new Set(
      [...latestByOrder.values()]
        .map(d => d.route_id)
        .filter((id): id is string => !!id)
    ),
  ];

  const routeMap = new Map<string, { external_route_id: string; driver_name: string | null }>();
  if (routeIds.length > 0) {
    const { data: routes, error: routesErr } = await supabase
      .from('routes')
      .select('id, external_route_id, driver_name')
      .eq('operator_id', operatorId)
      .in('id', routeIds);
    if (routesErr) throw routesErr;
    for (const r of (routes ?? []) as {
      id: string; external_route_id: string; driver_name: string | null;
    }[]) {
      routeMap.set(r.id, { external_route_id: r.external_route_id, driver_name: r.driver_name });
    }
  }

  for (const [orderId, dispatch] of latestByOrder) {
    const route = dispatch.route_id ? routeMap.get(dispatch.route_id) : undefined;
    result.set(orderId, {
      externalRouteId: dispatch.external_route_id ?? route?.external_route_id ?? null,
      driverName: route?.driver_name ?? null,
    });
  }

  return result;
}
