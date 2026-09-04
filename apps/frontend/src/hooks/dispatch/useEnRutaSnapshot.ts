'use client';

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { ON_ROAD_ROUTE_STATUSES, FINISHED_ROUTE_STATUSES } from '@/lib/dispatch/types';
import {
  buildEnRutaRoute,
  computeEnRutaMetrics,
  sortEnRutaRoutes,
  groupDispatchesByRoute,
  subtractDaysISO,
  type EnRutaRoute,
  type EnRutaMetrics,
  type RawDispatchRow,
  type RawRouteRow,
} from '@/lib/dispatch/en-ruta';

export interface EnRutaSnapshot {
  enRuta: EnRutaRoute[];
  /** The `1d` foot section, "COMPLETADAS HOY N" — today only. */
  completadasHoy: EnRutaRoute[];
  /** The standalone "Completadas" tab — last 7 days, matching the retired
   * `DispatchCompletedRoutesTab`'s `daysAgoISO(7)` window (decision 5 only
   * governs the foot section; the tab keeps its own history). */
  completadasSemana: EnRutaRoute[];
  metrics: EnRutaMetrics;
  /** Footer figure: dispatches whose stop failed and whose order is still
   * mid return — `orders.status` is `en_retorno` (nothing delivered) or
   * `parcialmente_entregado` (some delivered, the rest still awaiting
   * reingreso). Both are "not reingresado yet"; only a status past both
   * counts as resolved. Kept in lockstep with the `reingresos` preset's
   * filters (`lib/orders/order-view-presets.ts`) that
   * `?vista=reingresos` opens — widen one, widen the other. */
  fallidasSinReingreso: number;
}

/**
 * PostgREST's row cap (`packages/database/supabase/config.toml`'s
 * `max_rows`). A response landing on exactly this many rows must be
 * treated as truncated, not complete — this repo has already shipped one
 * incident (spec-52) from misreading a capped response as "that's all the
 * data". Silence is the unacceptable part: a wrong number on a monitoring
 * screen is worse than a thrown error.
 */
const MAX_ROWS_PER_QUERY = 1000;

/**
 * Route ids per `dispatches` chunk. Sized for expected ROWS, not route
 * count: `dispatches` fans out per route (many stops per route), unlike
 * the `orders`/`fleet_vehicles` chunks below, which are 1-row-per-id
 * lookups and cannot fan out. 30 route ids × a generous ~30 stops/route
 * average stays well under `MAX_ROWS_PER_QUERY`; `assertNotTruncated`
 * below is the actual safety net if that assumption is ever wrong for a
 * particular chunk.
 */
const DISPATCH_CHUNK_ROUTE_IDS = 30;
/** `orders`/`fleet_vehicles` chunks: 1 row per id, so this only bounds
 * `IN (...)` clause size, not response size. */
const LOOKUP_CHUNK_SIZE = 150;
/** On-road and completed cohorts are both floored to this many days back
 * (I4) — an unbounded on-road scan grows without limit (spec-76's "una
 * consulta sin cota temporal crece para siempre") and is what makes a
 * dispatches response actually reach `MAX_ROWS_PER_QUERY` in production
 * rather than staying theoretical. A route stranded on the road longer
 * than this drops off `1d` — a known, stated gap, not a silent one; older
 * stranded routes need their own surface, not an unbounded query here. */
const COHORT_DAYS_BACK = 7;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniq<T>(items: (T | null | undefined)[]): T[] {
  return Array.from(new Set(items.filter((v): v is T => v != null)));
}

/** Throws when a response lands on the PostgREST cap — see
 * `MAX_ROWS_PER_QUERY`'s doc. Never returns a "probably complete" guess. */
function assertNotTruncated(rows: unknown[], context: string): void {
  if (rows.length >= MAX_ROWS_PER_QUERY) {
    throw new Error(
      `useEnRutaSnapshot: ${context} returned ${rows.length} rows — hit PostgREST's ` +
      `max_rows cap (packages/database/supabase/config.toml) and was likely silently ` +
      `truncated. Narrow the chunk that produced this request.`,
    );
  }
}

/**
 * The `1d` "En ruta" snapshot — one call site for the header metrics, the
 * ordered table, its "Completadas hoy" foot section, and the standalone
 * Completadas tab (spec-75 decision 5: `DispatchEnRutaTab` and
 * `DispatchCompletadasTab` render the same `EnRutaTable`, just a different
 * slice — "una tabla con un filtro, no dos tablas").
 *
 * Bounding: both the on-road and the completed cohorts are floored to the
 * last `COHORT_DAYS_BACK` days (I4) — every downstream read (dispatches,
 * orders, fleet_vehicles) is bound to exactly those routes' ids, batched
 * with `Promise.all` and never awaited in a loop (production is ~112k
 * dispatches / ~61k packages). The `dispatches` read additionally chunks
 * by expected row count, not route count, and asserts it never lands on
 * PostgREST's row cap — see `MAX_ROWS_PER_QUERY`'s doc for why silent
 * truncation here is worse than an error.
 */
export function useEnRutaSnapshot(operatorId: string | null, date: string) {
  return useQuery({
    queryKey: ['dispatch', 'en-ruta', operatorId, date],
    queryFn: async (): Promise<EnRutaSnapshot> => {
      const supabase = createSPAClient();
      const routeSelect = 'id, external_route_id, driver_name, vehicle_id, status, route_date';
      const sinceDate = subtractDaysISO(date, COHORT_DAYS_BACK);

      const [onRoadRes, completedRes] = await Promise.all([
        supabase.from('routes').select(routeSelect)
          .eq('operator_id', operatorId!)
          .in('status', [...ON_ROAD_ROUTE_STATUSES])
          .gte('route_date', sinceDate)
          .is('deleted_at', null),
        supabase.from('routes').select(routeSelect)
          .eq('operator_id', operatorId!)
          .in('status', [...FINISHED_ROUTE_STATUSES])
          .gte('route_date', sinceDate)
          .is('deleted_at', null),
      ]);
      if (onRoadRes.error) throw onRoadRes.error;
      if (completedRes.error) throw completedRes.error;
      assertNotTruncated(onRoadRes.data ?? [], 'on-road routes query');
      assertNotTruncated(completedRes.data ?? [], 'completed routes query');

      const onRoadRows = (onRoadRes.data ?? []) as RawRouteRow[];
      const completedRows = (completedRes.data ?? []) as RawRouteRow[];
      const allRoutes = [...onRoadRows, ...completedRows];
      const routeIds = allRoutes.map((r) => r.id);
      const vehicleIds = uniq(allRoutes.map((r) => r.vehicle_id));

      const [dispatchChunkResults, vehicleRes] = await Promise.all([
        Promise.all(
          chunk(routeIds, DISPATCH_CHUNK_ROUTE_IDS).map(async (ids) => {
            const res = await supabase.from('dispatches')
              .select('route_id, order_id, status, completed_at, estimated_at, updated_at')
              .eq('operator_id', operatorId!)
              .in('route_id', ids)
              .is('deleted_at', null);
            if (res.error) throw res.error;
            assertNotTruncated(res.data ?? [], 'dispatches query');
            return (res.data ?? []) as RawDispatchRow[];
          }),
        ),
        vehicleIds.length
          ? supabase.from('fleet_vehicles').select('id, external_vehicle_id')
              .eq('operator_id', operatorId!)
              .in('id', vehicleIds)
              .is('deleted_at', null)
          : Promise.resolve({ data: [] as { id: string; external_vehicle_id: string | null }[], error: null }),
      ]);
      if (vehicleRes.error) throw vehicleRes.error;
      assertNotTruncated(vehicleRes.data ?? [], 'fleet_vehicles query');

      const dispatches = dispatchChunkResults.flat();
      const orderIds = uniq(dispatches.map((d) => d.order_id));

      // `orders.status` (order_status_enum, spec-43's return-flow states
      // including 'en_retorno'/'parcialmente_entregado') isn't in the
      // generated Supabase types — epic5 added the column, the generator
      // hasn't caught up since. Same `as any` escape hatch useOrderDetail.ts
      // already uses for the same gap, not a new pattern.
      const orderChunkResults = await Promise.all(
        chunk(orderIds, LOOKUP_CHUNK_SIZE).map(async (ids) => {
          const res = await (supabase.from('orders') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            .select('id, comuna, status')
            .eq('operator_id', operatorId!)
            .in('id', ids)
            .is('deleted_at', null);
          if (res.error) throw res.error;
          assertNotTruncated(res.data ?? [], 'orders query');
          return (res.data ?? []) as { id: string; comuna: string; status: string }[];
        }),
      );
      const orders = orderChunkResults.flat();

      const orderComunas = new Map(orders.map((o) => [o.id, o.comuna]));
      const orderStatusById = new Map(orders.map((o) => [o.id, o.status]));
      const vehicleIdentifiers = new Map(
        ((vehicleRes.data ?? []) as { id: string; external_vehicle_id: string | null }[])
          .map((v) => [v.id, v.external_vehicle_id]),
      );
      const dispatchesByRoute = groupDispatchesByRoute(dispatches);

      const enRuta = sortEnRutaRoutes(
        onRoadRows.map((r) => buildEnRutaRoute(r, dispatchesByRoute.get(r.id) ?? [], orderComunas, vehicleIdentifiers)),
      );
      const completadasSemana = sortEnRutaRoutes(
        completedRows.map((r) => buildEnRutaRoute(r, dispatchesByRoute.get(r.id) ?? [], orderComunas, vehicleIdentifiers)),
      );
      const completadasHoy = completadasSemana.filter((r) => r.routeDate === date);

      // Metrics (header row) are scoped to the on-road cohort only — its
      // dispatches are exactly "268 paradas" in "12 rutas · 268 paradas".
      const onRoadRouteIds = new Set(onRoadRows.map((r) => r.id));
      const onRoadDispatches = dispatches.filter((d) => d.route_id !== null && onRoadRouteIds.has(d.route_id));
      const metrics = computeEnRutaMetrics(onRoadDispatches);

      const fallidasSinReingreso = dispatches.filter((d) => {
        if (d.status !== 'failed' || !d.order_id) return false;
        const orderStatus = orderStatusById.get(d.order_id);
        return orderStatus === 'en_retorno' || orderStatus === 'parcialmente_entregado';
      }).length;

      return { enRuta, completadasHoy, completadasSemana, metrics, fallidasSinReingreso };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
