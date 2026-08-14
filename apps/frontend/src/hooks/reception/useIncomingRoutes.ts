import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export type IncomingRouteStatus = 'in_progress' | 'in_transit' | 'received';

export interface IncomingRoute {
  id: string;
  code: string;
  driver_id: string;
  driver_name: string | null;
  /**
   * The truck's registered plate, from the joined `vehicles` row — not
   * `pickup_routes.vehicle_label`, which since spec-52 is only an
   * expand-phase mirror kept alive until the contract phase drops it.
   */
  plate: string | null;
  in_transit_at: string | null;
  started_at: string | null;
  manifest_count: number;
  expected_packages: number;
}

interface PickupRouteWithRelations {
  id: string;
  code: string;
  driver_id: string;
  in_transit_at: string | null;
  started_at: string | null;
  driver: { full_name: string | null } | null;
  vehicle: { plate: string } | null;
  manifests: { id: string; total_packages: number | null }[];
  route_receptions: { expected_count: number }[];
}

/**
 * Pickup routes in one lifecycle status for the current operator — the lists
 * behind the hub's reception tabs. We pull driver name plus a lightweight
 * count of linked manifests and the expected_count from the route_reception
 * row when one exists.
 *
 * The status union deliberately includes `in_progress`: under spec-52 a route
 * only reaches `in_transit` *after* the receptionist has scanned its QR, so
 * "Rutas entrantes" — trucks still out collecting — is an `in_progress` list.
 * Narrowing this back to `in_transit` would silently redefine that tab as
 * "being unloaded" and cost the hub all forward visibility.
 *
 * Ordering follows the status: `in_progress` routes have no `in_transit_at`
 * yet, so they sort by `started_at`. Newest first either way.
 */
export function useIncomingRoutes(
  operatorId: string | null,
  status: IncomingRouteStatus = 'in_transit',
) {
  const orderColumn = status === 'in_progress' ? 'started_at' : 'in_transit_at';
  return useQuery<IncomingRoute[]>({
    queryKey: ['reception', 'incoming-routes', operatorId, status],
    enabled: !!operatorId,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('pickup_routes')
        .select(`
          id, code, driver_id, in_transit_at, started_at,
          driver:users!pickup_routes_driver_id_fkey(full_name),
          vehicle:vehicles(plate),
          manifests(id, total_packages),
          route_receptions(expected_count)
        `)
        .eq('operator_id', operatorId!)
        .eq('status', status)
        .is('deleted_at', null)
        .order(orderColumn, { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as PickupRouteWithRelations[];
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        driver_id: r.driver_id,
        driver_name: r.driver?.full_name ?? null,
        plate: r.vehicle?.plate ?? null,
        in_transit_at: r.in_transit_at,
        started_at: r.started_at ?? null,
        manifest_count: r.manifests?.length ?? 0,
        expected_packages:
          r.route_receptions?.[0]?.expected_count ??
          (r.manifests ?? []).reduce((sum, m) => sum + (m.total_packages ?? 0), 0),
      }));
    },
  });
}
