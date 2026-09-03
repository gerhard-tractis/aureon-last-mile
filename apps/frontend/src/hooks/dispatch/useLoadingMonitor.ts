import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { OPEN_ROUTE_STATUSES, type RouteStatus } from '@/lib/dispatch/types';
import { daysBeforeISO } from '@/lib/dispatch/loading-monitor';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import {
  aggregatePackagesByRoute,
  aggregateCrew,
  type DispatchLinkRow,
  type PackageLoadRow,
} from '@/lib/dispatch/loading-monitor-aggregate';

// Same chunking rationale as useRoutePackages.ts — PostgREST `.in()` puts
// every id in the request's query string, and enough UUIDs blow past a
// stack's request-line ceiling and fail the WHOLE query, not just degrade.
const ID_CHUNK_SIZE = 100;

// I3 review — this query used to have no lower bound at all: every route
// ever left open (draft/planned/loading/loaded, forever) stayed in scope,
// each fanning out to a dispatches read and then a packages read of every
// order on it, refetched every 30s. At the repo's real production scale
// (~112k dispatches / ~61k packages, per project memory) that is an
// unbounded and growing query, not a slow one. This screen's whole purpose
// is "what is on the dock RIGHT NOW" — a route still open after this many
// days is already a different, worse problem than a live loading monitor
// is for, so it is out of scope here rather than silently degrading this
// query for everyone.
const ROUTE_DATE_LOOKBACK_DAYS = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface LoadPositionEmbed { code: string; label: string | null }

interface RawRouteRow {
  id: string;
  external_route_id: string | null;
  route_date: string;
  status: RouteStatus;
  load_position_id: string | null;
  load_position_released_at: string | null;
  load_positions: LoadPositionEmbed | LoadPositionEmbed[] | null;
}

export interface LoadingMonitorRoute {
  id: string;
  externalRouteId: string | null;
  routeDate: string;
  status: RouteStatus;
  /** Only set while the route actually occupies the position — a released
   *  or never-assigned position renders nothing (see andén occupancy rule
   *  in load_positions' own migration comment: occupied requires
   *  load_position_id set AND load_position_released_at NULL). */
  loadPositionCode: string | null;
  loadPositionLabel: string | null;
  packagesTotal: number;
  packagesLoaded: number;
  firstScanAtIso: string | null;
  lastScanAtIso: string | null;
}

export interface CrewMember {
  userId: string;
  fullName: string;
  routeId: string;
  loadPositionLabel: string | null;
  scanCount: number;
  firstScanAtIso: string;
  lastScanAtIso: string;
}

export interface LoadingMonitorData {
  routes: LoadingMonitorRoute[];
  crew: CrewMember[];
  /** Sum of outstanding (planned - loaded) packages across every open
   *  route — the header's "N paquetes en andén esperando". A route already
   *  `loaded` contributes ~0 by construction (sealing requires every live
   *  package staged), so this naturally reads as "still on the dock". */
  packagesWaitingOnDock: number;
}

const EMPTY: LoadingMonitorData = { routes: [], crew: [], packagesWaitingOnDock: 0 };

/** Fetch one id-chunked table read, in parallel across chunks (I3 review —
 *  this used to be a `for…await` loop, serializing what is otherwise an
 *  embarrassingly parallel set of independent reads). */
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

export function useLoadingMonitor(operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'loading-monitor', operatorId],
    queryFn: async (): Promise<LoadingMonitorData> => {
      const supabase = createSPAClient();
      const sinceDate = daysBeforeISO(todayISOInTimezone(), ROUTE_DATE_LOOKBACK_DAYS);

      const { data: routeRows, error: routesError } = await supabase
        .from('routes')
        .select(
          'id, external_route_id, route_date, status, load_position_id, load_position_released_at, load_positions(code, label)',
        )
        .eq('operator_id', operatorId!)
        .in('status', [...OPEN_ROUTE_STATUSES])
        .gte('route_date', sinceDate)
        .is('deleted_at', null)
        .order('route_date', { ascending: false });
      if (routesError) throw routesError;

      const routes = (routeRows ?? []) as unknown as RawRouteRow[];
      if (routes.length === 0) return EMPTY;

      const routeIds = routes.map((r) => r.id);
      const dispatchLinks = await fetchChunked<DispatchLinkRow>(routeIds, (ids) =>
        supabase
          .from('dispatches')
          .select('id, route_id, order_id')
          .in('route_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      );

      const orderIds = [...new Set(dispatchLinks.map((d) => d.order_id).filter((id): id is string => !!id))];
      const packageRows = await fetchChunked<PackageLoadRow>(orderIds, (ids) =>
        supabase
          .from('packages')
          .select('order_id, loaded_at, loaded_by, status')
          .in('order_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      );

      const packageAggByRoute = aggregatePackagesByRoute(dispatchLinks, packageRows);
      const crewAgg = aggregateCrew(dispatchLinks, packageRows);

      const crewUserIds = [...new Set(crewAgg.map((c) => c.userId))];
      const userRows = await fetchChunked<{ id: string; full_name: string }>(crewUserIds, (ids) =>
        supabase
          .from('users')
          .select('id, full_name')
          .in('id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      );
      const namesByUserId = new Map(userRows.map((u) => [u.id, u.full_name]));

      const loadPositionLabelByRoute = new Map<string, string | null>();

      const monitorRoutes: LoadingMonitorRoute[] = routes.map((r) => {
        // Occupancy predicate from load_positions' migration comment:
        // occupied === load_position_id set AND load_position_released_at
        // NULL. A released or unassigned position shows nothing rather
        // than a stale andén nobody is actually standing at.
        const occupied = !!r.load_position_id && !r.load_position_released_at;
        const position = occupied ? firstOf(r.load_positions) : null;
        loadPositionLabelByRoute.set(r.id, position?.label ?? position?.code ?? null);

        const agg = packageAggByRoute.get(r.id);
        return {
          id: r.id,
          externalRouteId: r.external_route_id,
          routeDate: r.route_date,
          status: r.status,
          loadPositionCode: position?.code ?? null,
          loadPositionLabel: position?.label ?? null,
          packagesTotal: agg?.total ?? 0,
          packagesLoaded: agg?.loaded ?? 0,
          firstScanAtIso: agg?.firstScanAtIso ?? null,
          lastScanAtIso: agg?.lastScanAtIso ?? null,
        };
      });

      const crew: CrewMember[] = crewAgg
        .map((c) => ({
          userId: c.userId,
          fullName: namesByUserId.get(c.userId) ?? 'Usuario',
          routeId: c.routeId,
          loadPositionLabel: loadPositionLabelByRoute.get(c.routeId) ?? null,
          scanCount: c.scanCount,
          firstScanAtIso: c.firstScanAtIso,
          lastScanAtIso: c.lastScanAtIso,
        }))
        .sort((a, b) => Date.parse(b.lastScanAtIso) - Date.parse(a.lastScanAtIso));

      const packagesWaitingOnDock = monitorRoutes.reduce(
        (sum, r) => sum + Math.max(0, r.packagesTotal - r.packagesLoaded),
        0,
      );

      return { routes: monitorRoutes, crew, packagesWaitingOnDock };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
