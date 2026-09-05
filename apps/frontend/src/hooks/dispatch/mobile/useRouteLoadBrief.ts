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
  boxCountsByOrder,
  type BriefDispatchRow,
  type BriefPackageRow,
  type ComunaCount,
  type IncompleteOrder,
  type OrderBoxCount,
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
  /**
   * spec-77 Fase 2 (`2j`) — the dispatch review needs "fecha de reparto"
   * and this hook already reads one row from `routes`; a second query just
   * for this column would duplicate the fetch `2j` otherwise shares with
   * `2c`/`2e` via the same react-query cache key.
   */
  routeDate: string | null;
  comunas: ComunaCount[];
  incompleteOrders: IncompleteOrder[];
  loadPositionLabel: string | null;
  vehicleAssignment: { externalVehicleId: string; driverName: string | null } | null;
  /**
   * spec-78 (`3a`) — "vehículo con su ocupación". `fleet_vehicles
   * .capacity_packages` only (never a volume figure — see spec-78's own
   * "Campos del canvas que no existen en el schema" table), read
   * alongside `external_vehicle_id` in the same query rather than a
   * second fetch. `null` when unset — `RouteTrackingVehiclePanel`
   * (reused verbatim from `1c`) already renders "Sin capacidad
   * configurada" for that case rather than a fabricated bar.
   */
  vehicleCapacityPackages: number | null;
  /**
   * spec-78 — the fraction ("2 de 3") `DispatchIncompleteOrdersWarning`
   * doesn't carry (see `boxCountsByOrder`'s own doc comment). Keyed by
   * `order_id` for every order on the route, not only the incomplete
   * ones — the tablet's incomplete-orders list is the only current
   * caller, but there is no reason to narrow it there.
   */
  orderBoxCounts: Map<string, OrderBoxCount>;
}

const EMPTY: RouteLoadBrief = {
  ordersCount: 0,
  stopsCount: 0,
  pendingOnDock: 0,
  routeDate: null,
  comunas: [],
  incompleteOrders: [],
  loadPositionLabel: null,
  vehicleAssignment: null,
  vehicleCapacityPackages: null,
  orderBoxCounts: new Map(),
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
        .select('vehicle_id, driver_name, route_date, load_position_id, load_position_released_at, load_positions(code, label)')
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
      let vehicleCapacityPackages: number | null = null;
      if (routeRow.vehicle_id) {
        const { data: vehicleRow } = await supabase
          .from('fleet_vehicles')
          .select('external_vehicle_id, capacity_packages')
          .eq('id', routeRow.vehicle_id)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null)
          .maybeSingle();
        vehicleCapacityPackages = vehicleRow?.capacity_packages ?? null;
        if (vehicleRow?.external_vehicle_id) {
          // Review I1 — this used to fall back to fleet_vehicles.driver_name
          // (the vehicle's fleet-level "last known driver", synced from a
          // webhook, possibly weeks stale) whenever routeRow.driver_name was
          // null. That fallback fires exactly when the crew assigned a
          // truck and deliberately left the driver blank — asserting a
          // driver under a label ("Vehículo y conductor") that names a
          // fact this route does not actually have (Lecciones aplicadas
          // "no proxy under a label that asserts a fact"). routes.driver_name
          // is the only honest source for THIS route's driver; null means
          // "Sin conductor", not a guess. The vehicle's usual driver is
          // already offered as a prefill in the assignment sheet, which is
          // the right place for a suggestion, not here.
          vehicleAssignment = {
            externalVehicleId: vehicleRow.external_vehicle_id,
            driverName: routeRow.driver_name ?? null,
          };
        }
      }

      return {
        ordersCount: new Set(dispatches.map((d) => d.order_id)).size,
        stopsCount: countStops(dispatches),
        pendingOnDock: countPendingOnDock(packageRows),
        routeDate: routeRow.route_date ?? null,
        comunas: comunaBreakdown(dispatches, comunaByOrder),
        incompleteOrders: findIncompleteOrders(dispatches, packagesByOrder),
        loadPositionLabel: position?.label ?? position?.code ?? null,
        vehicleAssignment,
        vehicleCapacityPackages,
        orderBoxCounts: boxCountsByOrder(packagesByOrder),
      };
    },
    enabled,
    staleTime: 10_000,
  });
}
