import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ReturnRoute {
  externalRouteId: string;        // 'Sin ruta' for orphaned packages
  driverName: string | null;
  packageCount: number;
  oldestStatusUpdatedAt: string;  // ISO string — min(status_updated_at) for the route
}

interface RawPackage {
  id: string;
  order_id: string;
  status_updated_at: string;
}

interface RawDispatch {
  order_id: string;
  route_id: string;
  created_at: string;
}

interface RawRoute {
  id: string;
  external_route_id: string;
  driver_name: string | null;
}

async function fetchReturnRoutes(operatorId: string): Promise<ReturnRoute[]> {
  const supabase = createSPAClient();

  // 1. Fetch all retorno_hub packages for this operator
  const { data: pkgs, error: pkgsErr } = await supabase
    .from('packages')
    .select('id, order_id, status_updated_at')
    .eq('operator_id', operatorId)
    .eq('status', 'retorno_hub')
    .is('deleted_at', null);

  if (pkgsErr) throw pkgsErr;
  if (!pkgs || pkgs.length === 0) return [];

  const packages = pkgs as RawPackage[];
  const orderIds = packages.map(p => p.order_id);

  // 2. Fetch the most-recent dispatch per order to find route assignments
  const { data: dispatches, error: dispErr } = await supabase
    .from('dispatches')
    .select('order_id, route_id, created_at')
    .in('order_id', orderIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (dispErr) throw dispErr;
  const allDispatches = (dispatches as RawDispatch[]) ?? [];

  // Pick the most-recent dispatch per order_id
  const latestDispatchByOrder = new Map<string, RawDispatch>();
  for (const d of allDispatches) {
    if (!latestDispatchByOrder.has(d.order_id)) {
      latestDispatchByOrder.set(d.order_id, d);
    }
  }

  // 3. Fetch route details for all referenced route IDs
  const routeIds = [...new Set(allDispatches.map(d => d.route_id))];
  let routeMap = new Map<string, RawRoute>();

  if (routeIds.length > 0) {
    const { data: routes, error: routesErr } = await supabase
      .from('routes')
      .select('id, external_route_id, driver_name')
      .in('id', routeIds);

    if (routesErr) throw routesErr;
    for (const r of (routes as RawRoute[]) ?? []) {
      routeMap.set(r.id, r);
    }
  }

  // 4. Group packages by external_route_id
  const groups = new Map<
    string,
    { driverName: string | null; packages: RawPackage[] }
  >();

  for (const pkg of packages) {
    const dispatch = latestDispatchByOrder.get(pkg.order_id);
    let externalRouteId = 'Sin ruta';
    let driverName: string | null = null;

    if (dispatch) {
      const route = routeMap.get(dispatch.route_id);
      if (route) {
        externalRouteId = route.external_route_id;
        driverName = route.driver_name;
      }
    }

    const existing = groups.get(externalRouteId);
    if (existing) {
      existing.packages.push(pkg);
    } else {
      groups.set(externalRouteId, { driverName, packages: [pkg] });
    }
  }

  // 5. Build the output array
  const result: ReturnRoute[] = [];
  for (const [externalRouteId, { driverName, packages: routePkgs }] of groups) {
    const oldest = routePkgs.reduce((min, p) =>
      p.status_updated_at < min ? p.status_updated_at : min,
      routePkgs[0].status_updated_at
    );
    result.push({
      externalRouteId,
      driverName,
      packageCount: routePkgs.length,
      oldestStatusUpdatedAt: oldest,
    });
  }

  return result;
}

export function useReturnRoutes(operatorId: string | null): {
  data: ReturnRoute[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['return-routes', operatorId],
    queryFn: () => fetchReturnRoutes(operatorId!),
    enabled: !!operatorId,
    staleTime: 30_000,
  });

  return {
    data: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
