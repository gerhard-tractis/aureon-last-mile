import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { resolveRoutesByOrder } from './returnRouteResolution';

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

async function fetchReturnRoutes(operatorId: string): Promise<ReturnRoute[]> {
  const supabase = createSPAClient();

  const { data: pkgs, error: pkgsErr } = await supabase
    .from('packages')
    .select('id, order_id, status_updated_at')
    .eq('operator_id', operatorId)
    .eq('status', 'retorno_hub')
    .is('deleted_at', null);

  if (pkgsErr) throw pkgsErr;
  if (!pkgs || pkgs.length === 0) return [];

  const packages = pkgs as RawPackage[];
  const orderIds = [...new Set(packages.map(p => p.order_id))];

  const routesByOrder = await resolveRoutesByOrder(supabase, operatorId, orderIds);

  const groups = new Map<
    string,
    { driverName: string | null; packages: RawPackage[] }
  >();

  for (const pkg of packages) {
    const route = routesByOrder.get(pkg.order_id);
    const externalRouteId = route?.externalRouteId ?? 'Sin ruta';
    const driverName = route?.driverName ?? null;

    const existing = groups.get(externalRouteId);
    if (existing) {
      existing.packages.push(pkg);
    } else {
      groups.set(externalRouteId, { driverName, packages: [pkg] });
    }
  }

  const result: ReturnRoute[] = [];
  for (const [externalRouteId, { driverName, packages: routePkgs }] of groups) {
    const oldest = routePkgs
      .slice(1)
      .reduce(
        (min, p) => (p.status_updated_at < min ? p.status_updated_at : min),
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
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['return-routes', operatorId],
    queryFn: () => fetchReturnRoutes(operatorId!),
    enabled: !!operatorId,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    const channel = supabase
      .channel(`returns:${operatorId}:packages`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'packages',
          filter: `operator_id=eq.${operatorId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['return-routes', operatorId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [operatorId, queryClient]);

  return {
    data: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
