import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { OPEN_ROUTE_STATUSES, type RouteStatus } from '@/lib/dispatch/types';
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface FleetVehicleEmbed { plate_number: string | null; vehicle_type: string | null }
interface LoadPositionEmbed { code: string; label: string | null }

interface RawRouteRow {
  id: string;
  external_route_id: string | null;
  route_date: string;
  driver_name: string | null;
  status: RouteStatus;
  load_position_id: string | null;
  load_position_released_at: string | null;
  created_at: string;
  updated_at: string;
  fleet_vehicles: FleetVehicleEmbed | FleetVehicleEmbed[] | null;
  load_positions: LoadPositionEmbed | LoadPositionEmbed[] | null;
}

export interface LoadingMonitorRoute {
  id: string;
  externalRouteId: string | null;
  routeDate: string;
  status: RouteStatus;
  driverName: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
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
  /**
   * `routes.updated_at` while `status === 'loaded'` — the closest real
   * timestamp to "when this route closed". There is no dedicated
   * `sealed_at`/`closed_at` column (transition_route_status only writes
   * `status` + the generic `updated_at` trigger); nothing else in the
   * current flow mutates a route after it reaches `loaded` and before
   * dispatch, so this is an honest proxy, not a fabricated figure — but it
   * IS a proxy, not a dedicated fact, and a future write between seal and
   * dispatch would silently move it.
   */
  updatedAtIso: string;
}

export interface CrewMember {
  userId: string;
  fullName: string;
  routeId: string;
  loadPositionLabel: string | null;
  scanCount: number;
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

export function useLoadingMonitor(operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'loading-monitor', operatorId],
    queryFn: async (): Promise<LoadingMonitorData> => {
      const supabase = createSPAClient();

      const { data: routeRows, error: routesError } = await supabase
        .from('routes')
        .select(
          'id, external_route_id, route_date, driver_name, status, load_position_id, load_position_released_at, created_at, updated_at, fleet_vehicles(plate_number, vehicle_type), load_positions(code, label)',
        )
        .eq('operator_id', operatorId!)
        .in('status', [...OPEN_ROUTE_STATUSES])
        .is('deleted_at', null)
        .order('route_date', { ascending: false });
      if (routesError) throw routesError;

      const routes = (routeRows ?? []) as unknown as RawRouteRow[];
      if (routes.length === 0) return EMPTY;

      const routeIds = routes.map((r) => r.id);
      const dispatchLinks: DispatchLinkRow[] = [];
      for (const ids of chunk(routeIds, ID_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from('dispatches')
          .select('id, route_id, order_id')
          .in('route_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null);
        if (error) throw error;
        dispatchLinks.push(...((data ?? []) as DispatchLinkRow[]));
      }

      const orderIds = [...new Set(dispatchLinks.map((d) => d.order_id).filter((id): id is string => !!id))];
      const packageRows: PackageLoadRow[] = [];
      for (const ids of chunk(orderIds, ID_CHUNK_SIZE)) {
        if (ids.length === 0) continue;
        const { data, error } = await supabase
          .from('packages')
          .select('order_id, loaded_at, loaded_by, status')
          .in('order_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null);
        if (error) throw error;
        packageRows.push(...((data ?? []) as PackageLoadRow[]));
      }

      const packageAggByRoute = aggregatePackagesByRoute(dispatchLinks, packageRows);
      const crewAgg = aggregateCrew(dispatchLinks, packageRows);

      const crewUserIds = [...new Set(crewAgg.map((c) => c.userId))];
      const namesByUserId = new Map<string, string>();
      for (const ids of chunk(crewUserIds, ID_CHUNK_SIZE)) {
        if (ids.length === 0) continue;
        const { data, error } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null);
        if (error) throw error;
        for (const u of (data ?? []) as { id: string; full_name: string }[]) {
          namesByUserId.set(u.id, u.full_name);
        }
      }

      const loadPositionLabelByRoute = new Map<string, string | null>();

      const monitorRoutes: LoadingMonitorRoute[] = routes.map((r) => {
        const vehicle = firstOf(r.fleet_vehicles);
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
          driverName: r.driver_name,
          vehiclePlate: vehicle?.plate_number ?? null,
          vehicleType: vehicle?.vehicle_type ?? null,
          loadPositionCode: position?.code ?? null,
          loadPositionLabel: position?.label ?? null,
          packagesTotal: agg?.total ?? 0,
          packagesLoaded: agg?.loaded ?? 0,
          firstScanAtIso: agg?.firstScanAtIso ?? null,
          lastScanAtIso: agg?.lastScanAtIso ?? null,
          updatedAtIso: r.updated_at,
        };
      });

      const crew: CrewMember[] = crewAgg
        .map((c) => ({
          userId: c.userId,
          fullName: namesByUserId.get(c.userId) ?? 'Usuario',
          routeId: c.routeId,
          loadPositionLabel: loadPositionLabelByRoute.get(c.routeId) ?? null,
          scanCount: c.scanCount,
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
