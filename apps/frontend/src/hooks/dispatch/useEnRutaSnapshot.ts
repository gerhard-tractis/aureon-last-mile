'use client';

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { ON_ROAD_ROUTE_STATUSES, FINISHED_ROUTE_STATUSES } from '@/lib/dispatch/types';
import {
  buildEnRutaRoute,
  computeEnRutaMetrics,
  sortEnRutaRoutes,
  type EnRutaRoute,
  type EnRutaMetrics,
  type RawDispatchRow,
  type RawRouteRow,
} from '@/lib/dispatch/en-ruta';

export interface EnRutaSnapshot {
  enRuta: EnRutaRoute[];
  completadas: EnRutaRoute[];
  metrics: EnRutaMetrics;
  /** Footer figure: dispatches whose stop failed and whose order has not
   * yet come back through reception (`orders.status` still `en_retorno` —
   * spec-43's return flow. Anything past that has been reingresado). */
  fallidasSinReingreso: number;
}

const CHUNK_SIZE = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniq<T>(items: (T | null | undefined)[]): T[] {
  return Array.from(new Set(items.filter((v): v is T => v != null)));
}

/**
 * The `1d` "En ruta" snapshot — one call site for the header metrics, the
 * ordered table, and its "Completadas hoy" section (spec-75 decision 5: one
 * table with a filter, not two).
 *
 * Bounding: the on-road cohort (`ON_ROAD_ROUTE_STATUSES`) is NOT filtered by
 * date, matching `useDispatchKPIs`'s documented precedent — a route on the
 * road is on the road regardless of which day it was dispatched, and that
 * set is inherently small (active routes only). "Completadas hoy" IS bound
 * to `date`, because finished routes accumulate forever otherwise. Every
 * downstream read (dispatches, orders, fleet_vehicles) is bound to exactly
 * those routes' ids — never a standalone date-unbounded scan — and batched
 * with `Promise.all`, not awaited in a loop (production is ~112k dispatches
 * / ~61k packages).
 */
export function useEnRutaSnapshot(operatorId: string | null, date: string) {
  return useQuery({
    queryKey: ['dispatch', 'en-ruta', operatorId, date],
    queryFn: async (): Promise<EnRutaSnapshot> => {
      const supabase = createSPAClient();
      const routeSelect = 'id, external_route_id, driver_name, vehicle_id, status, route_date, planned_stops, completed_stops';

      const [onRoadRes, completedRes] = await Promise.all([
        supabase.from('routes').select(routeSelect)
          .eq('operator_id', operatorId!)
          .in('status', [...ON_ROAD_ROUTE_STATUSES])
          .is('deleted_at', null),
        supabase.from('routes').select(routeSelect)
          .eq('operator_id', operatorId!)
          .in('status', [...FINISHED_ROUTE_STATUSES])
          .eq('route_date', date)
          .is('deleted_at', null),
      ]);
      if (onRoadRes.error) throw onRoadRes.error;
      if (completedRes.error) throw completedRes.error;

      const onRoadRows = (onRoadRes.data ?? []) as RawRouteRow[];
      const completedRows = (completedRes.data ?? []) as RawRouteRow[];
      const allRoutes = [...onRoadRows, ...completedRows];
      const routeIds = allRoutes.map((r) => r.id);
      const vehicleIds = uniq(allRoutes.map((r) => r.vehicle_id));

      const [dispatchChunkResults, vehicleRes] = await Promise.all([
        Promise.all(
          chunk(routeIds, CHUNK_SIZE).map((ids) =>
            supabase.from('dispatches')
              .select('route_id, order_id, status, completed_at, estimated_at, updated_at')
              .eq('operator_id', operatorId!)
              .in('route_id', ids)
              .is('deleted_at', null),
          ),
        ),
        vehicleIds.length
          ? supabase.from('fleet_vehicles').select('id, external_vehicle_id')
              .eq('operator_id', operatorId!)
              .in('id', vehicleIds)
          : Promise.resolve({ data: [] as { id: string; external_vehicle_id: string | null }[], error: null }),
      ]);
      for (const res of dispatchChunkResults) if (res.error) throw res.error;
      if (vehicleRes.error) throw vehicleRes.error;

      const dispatches = dispatchChunkResults.flatMap((r) => r.data ?? []) as RawDispatchRow[];
      const orderIds = uniq(dispatches.map((d) => d.order_id));

      // `orders.status` (order_status_enum, spec-43's return-flow states
      // including 'en_retorno') isn't in the generated Supabase types —
      // epic5 added the column, the generator hasn't caught up since. Same
      // `as any` escape hatch useOrderDetail.ts already uses for the same
      // gap, not a new pattern.
      const orderChunkResults = await Promise.all(
        chunk(orderIds, CHUNK_SIZE).map((ids) =>
          (supabase.from('orders') as any).select('id, comuna, status') // eslint-disable-line @typescript-eslint/no-explicit-any
            .eq('operator_id', operatorId!)
            .in('id', ids),
        ),
      );
      for (const res of orderChunkResults) if (res.error) throw res.error;
      const orders = orderChunkResults.flatMap(
        (r) => (r.data ?? []) as { id: string; comuna: string; status: string }[],
      );

      const orderComunas = new Map(orders.map((o) => [o.id, o.comuna]));
      const orderStatusById = new Map(orders.map((o) => [o.id, o.status]));
      const vehicleIdentifiers = new Map(
        ((vehicleRes.data ?? []) as { id: string; external_vehicle_id: string | null }[])
          .map((v) => [v.id, v.external_vehicle_id]),
      );

      const enRuta = sortEnRutaRoutes(
        onRoadRows.map((r) => buildEnRutaRoute(r, dispatches, orderComunas, vehicleIdentifiers)),
      );
      const completadas = sortEnRutaRoutes(
        completedRows.map((r) => buildEnRutaRoute(r, dispatches, orderComunas, vehicleIdentifiers)),
      );

      // Metrics (header row) are scoped to the on-road cohort only — its
      // dispatches are exactly "268 paradas" in "12 rutas · 268 paradas".
      const onRoadDispatches = dispatches.filter((d) => onRoadRows.some((r) => r.id === d.route_id));
      const metrics = computeEnRutaMetrics(onRoadDispatches);

      const fallidasSinReingreso = dispatches.filter(
        (d) => d.status === 'failed' && d.order_id && orderStatusById.get(d.order_id) === 'en_retorno',
      ).length;

      return { enRuta, completadas, metrics, fallidasSinReingreso };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
