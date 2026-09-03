// apps/frontend/src/hooks/dispatch/mobile/useRouteLoadBrief.ts
//
// spec-76 phase 3 — fetching for 2c ("Antes de escanear"): dock counts,
// incomplete-order warning, comunas and vehicle assignment for ONE route.
// Only mounted below `lg` (RouteBuilder gates it with `enabled: isBelowLg`)
// so a desktop session never pays for this extra read.
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import {
  comunaBreakdown,
  countStops,
  countPendingOnDock,
  findIncompleteOrders,
  groupPackagesByOrder,
  type BriefDispatchRow,
  type BriefPackageRow,
  type ComunaCount,
  type IncompleteOrder,
} from '@/lib/dispatch/mobile/route-load-brief';

const ID_CHUNK_SIZE = 100;

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
    chunk(ids, ID_CHUNK_SIZE)
      .filter((c) => c.length > 0)
      .map(async (c) => {
        const { data, error } = await run(c);
        if (error) throw error;
        return data ?? [];
      }),
  );
  return results.flat();
}

export interface RouteLoadBrief {
  ordersCount: number;
  stopsCount: number;
  pendingOnDock: number;
  comunas: ComunaCount[];
  incompleteOrders: IncompleteOrder[];
  loadPositionLabel: string | null;
  vehicleAssignment: { externalVehicleId: string; driverName: string | null } | null;
}

const EMPTY: RouteLoadBrief = {
  ordersCount: 0,
  stopsCount: 0,
  pendingOnDock: 0,
  comunas: [],
  incompleteOrders: [],
  loadPositionLabel: null,
  vehicleAssignment: null,
};

interface Options {
  enabled?: boolean;
}

export function useRouteLoadBrief(
  routeId: string | null,
  operatorId: string | null,
  options: Options = {},
) {
  const enabled = (options.enabled ?? true) && !!routeId && !!operatorId;
  return useQuery({
    queryKey: ['dispatch', 'mobile', 'route-load-brief', routeId, operatorId],
    queryFn: async (): Promise<RouteLoadBrief> => {
      const supabase = createSPAClient();

      const { data: routeRow, error: routeError } = await supabase
        .from('routes')
        .select('vehicle_id, driver_name, load_position_id, load_position_released_at, load_positions(code, label)')
        .eq('id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .single();
      if (routeError) throw routeError;

      const { data: dispatchRows, error: dispatchError } = await supabase
        .from('dispatches')
        .select('order_id, orders(order_number, delivery_address, comuna)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (dispatchError) throw dispatchError;

      const rows = dispatchRows ?? [];
      if (rows.length === 0) return EMPTY;

      const dispatches: BriefDispatchRow[] = rows.map((d) => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          order_id: d.order_id as string,
          order_number: ord?.order_number ?? '',
          contact_address: ord?.delivery_address ?? null,
        };
      });
      const comunaByOrder = new Map(
        rows.map((d) => {
          const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
          return [d.order_id as string, ord?.comuna ?? null] as const;
        }),
      );

      const orderIds = [...new Set(dispatches.map((d) => d.order_id))];
      const packageRows = await fetchChunked<BriefPackageRow>(orderIds, (ids) =>
        supabase
          .from('packages')
          .select('order_id, status, loaded_at')
          .in('order_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      );

      const packagesByOrder = groupPackagesByOrder(packageRows);

      const occupied = !!routeRow.load_position_id && !routeRow.load_position_released_at;
      const position = occupied
        ? Array.isArray(routeRow.load_positions)
          ? routeRow.load_positions[0]
          : routeRow.load_positions
        : null;

      let vehicleAssignment: RouteLoadBrief['vehicleAssignment'] = null;
      if (routeRow.vehicle_id) {
        const { data: vehicleRow } = await supabase
          .from('fleet_vehicles')
          .select('external_vehicle_id, driver_name')
          .eq('id', routeRow.vehicle_id)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null)
          .maybeSingle();
        if (vehicleRow?.external_vehicle_id) {
          // spec-76 task 2 fix — this used to read the vehicle's
          // fleet_vehicles.driver_name ("last known driver", set by the
          // DispatchTrack webhook sync, spec-52 migration comment). That
          // was the only real column available before this task, because
          // routes.driver_name was permanently NULL (only the dispatch
          // handler wrote it, after `loaded`). Now that `PATCH
          // /api/dispatch/routes/[id]` (2d) writes routes.driver_name at
          // assignment time — the actual driver named for THIS trip, not
          // the vehicle's usual one — that is the authoritative value.
          // fleet_vehicles.driver_name is kept only as a fallback for a
          // route whose vehicle got linked with no driver typed at all.
          vehicleAssignment = {
            externalVehicleId: vehicleRow.external_vehicle_id,
            driverName: routeRow.driver_name ?? vehicleRow.driver_name,
          };
        }
      }

      return {
        ordersCount: new Set(dispatches.map((d) => d.order_id)).size,
        stopsCount: countStops(dispatches),
        pendingOnDock: countPendingOnDock(packageRows),
        comunas: comunaBreakdown(dispatches, comunaByOrder),
        incompleteOrders: findIncompleteOrders(dispatches, packagesByOrder),
        loadPositionLabel: position?.label ?? position?.code ?? null,
        vehicleAssignment,
      };
    },
    enabled,
    staleTime: 10_000,
  });
}
