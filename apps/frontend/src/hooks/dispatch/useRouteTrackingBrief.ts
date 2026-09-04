// apps/frontend/src/hooks/dispatch/useRouteTrackingBrief.ts
//
// spec-75 phase 4 — data for the `1c` read-only route tracking view. Same
// dispatches -> orders / packages two-hop shape as useRouteLoadBrief.ts
// (spec-76, mobile 2c) and useLoadingMonitor.ts (spec-75 phase 3), scoped
// to one route, enriched with the per-order fields 1c needs (comuna,
// address, customer name) and the vehicle's configured capacity.
//
// Polls every 15s (refetchInterval) — this is a spectator screen with no
// realtime subscription in this repo's dispatch module (loading-monitor.ts
// and useRouteLoadBrief.ts both poll rather than subscribe); matches that
// precedent rather than inventing a new transport.
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { buildRouteTrackingSummary, type TrackingDispatchRow, type TrackingPackageRow } from '@/lib/dispatch/route-tracking';
import type { RouteTrackingSummary } from '@/lib/dispatch/route-tracking';

const ORDER_ID_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchChunked<Row>(
  ids: string[],
  run: (chunkIds: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const results = await Promise.all(
    chunk(ids, ORDER_ID_CHUNK_SIZE)
      .filter((c) => c.length > 0)
      .map(async (c) => {
        const { data, error } = await run(c);
        if (error) throw error;
        return data ?? [];
      }),
  );
  return results.flat();
}

export interface RouteTrackingBrief extends RouteTrackingSummary {
  routeDate: string | null;
  loadPositionLabel: string | null;
  /** Full name of whoever loaded the most recent package — the "está
   *  escaneando" line's subject. Null when nothing has been scanned yet. */
  scannerName: string | null;
  vehicleExternalId: string | null;
  /** routes.driver_name only — never fleet_vehicles.driver_name (spec-76
   *  review I1 / this task's own lesson 3): the fleet-level "usual driver"
   *  is a different fact from who is actually assigned to THIS route. */
  driverName: string | null;
  vehicleCapacityPackages: number | null;
}

const EMPTY: RouteTrackingBrief = {
  scans: [],
  packagesLoadedCount: 0,
  packagesExpectedCount: 0,
  packagesUnscannedCount: 0,
  pendingOrders: [],
  routeDate: null,
  loadPositionLabel: null,
  scannerName: null,
  vehicleExternalId: null,
  driverName: null,
  vehicleCapacityPackages: null,
};

export function useRouteTrackingBrief(routeId: string | null, operatorId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['dispatch', 'route-tracking', routeId, operatorId],
    queryFn: async (): Promise<RouteTrackingBrief> => {
      const supabase = createSPAClient();

      // Phase-4 review — `routes` and `dispatches` don't depend on each
      // other; this used to await them in sequence, costing a full extra
      // round trip on every 15s poll for no reason.
      const [
        { data: routeRow, error: routeError },
        { data: dispatchRows, error: dispatchError },
      ] = await Promise.all([
        supabase
          .from('routes')
          .select(
            'route_date, driver_name, vehicle_id, load_position_id, load_position_released_at, load_positions(code, label)',
          )
          .eq('id', routeId!)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null)
          .single(),
        supabase
          .from('dispatches')
          .select('order_id, orders(order_number, comuna, delivery_address, customer_name)')
          .eq('route_id', routeId!)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      ]);
      if (routeError) throw routeError;
      if (dispatchError) throw dispatchError;

      const rows = dispatchRows ?? [];
      const dispatches: TrackingDispatchRow[] = rows
        .filter((d): d is typeof d & { order_id: string } => !!d.order_id)
        .map((d) => {
          const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
          return {
            order_id: d.order_id,
            order_number: ord?.order_number ?? '',
            comuna: ord?.comuna ?? null,
            address: ord?.delivery_address ?? null,
            customerName: ord?.customer_name ?? null,
          };
        });

      const occupied = !!routeRow.load_position_id && !routeRow.load_position_released_at;
      const position = occupied
        ? Array.isArray(routeRow.load_positions)
          ? routeRow.load_positions[0]
          : routeRow.load_positions
        : null;

      let vehicleExternalId: string | null = null;
      let vehicleCapacityPackages: number | null = null;
      if (routeRow.vehicle_id) {
        const { data: vehicleRow } = await supabase
          .from('fleet_vehicles')
          .select('external_vehicle_id, capacity_packages')
          .eq('id', routeRow.vehicle_id)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null)
          .maybeSingle();
        vehicleExternalId = vehicleRow?.external_vehicle_id ?? null;
        vehicleCapacityPackages = vehicleRow?.capacity_packages ?? null;
      }

      if (dispatches.length === 0) {
        return {
          ...EMPTY,
          routeDate: routeRow.route_date ?? null,
          loadPositionLabel: position?.label ?? position?.code ?? null,
          vehicleExternalId,
          driverName: routeRow.driver_name ?? null,
          vehicleCapacityPackages,
        };
      }

      const orderIds = [...new Set(dispatches.map((d) => d.order_id))];
      const packageRows = await fetchChunked<TrackingPackageRow>(orderIds, (ids) =>
        supabase
          .from('packages')
          .select('id, order_id, label, loaded_at, loaded_by, status')
          .in('order_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      );

      const summary = buildRouteTrackingSummary(dispatches, packageRows);

      let scannerName: string | null = null;
      const scannerUserId = summary.scans[0]?.loadedBy ?? null;
      if (scannerUserId) {
        const { data: userRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', scannerUserId)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null)
          .maybeSingle();
        scannerName = userRow?.full_name ?? null;
      }

      return {
        ...summary,
        routeDate: routeRow.route_date ?? null,
        loadPositionLabel: position?.label ?? position?.code ?? null,
        scannerName,
        vehicleExternalId,
        driverName: routeRow.driver_name ?? null,
        vehicleCapacityPackages,
      };
    },
    enabled: enabled && !!routeId && !!operatorId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
