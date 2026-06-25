import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface IncomingRoute {
  id: string;
  code: string;
  driver_id: string;
  driver_name: string | null;
  vehicle_label: string | null;
  in_transit_at: string | null;
  manifest_count: number;
  expected_packages: number;
}

interface PickupRouteWithRelations {
  id: string;
  code: string;
  driver_id: string;
  vehicle_label: string | null;
  in_transit_at: string | null;
  driver: { full_name: string | null } | null;
  manifests: { id: string; total_packages: number | null }[];
  route_receptions: { expected_count: number }[];
}

/**
 * Pickup routes in status='in_transit' for the current operator — the list
 * the hub sees in the "Rutas entrantes" tab. We pull driver name plus a
 * lightweight count of linked manifests and the expected_count from the
 * already-created route_reception row (the close-route trigger inserts it
 * with the count baked in). Returns the newest first.
 */
export function useIncomingRoutes(operatorId: string | null, status: 'in_transit' | 'received' = 'in_transit') {
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
          id, code, driver_id, vehicle_label, in_transit_at,
          driver:users!pickup_routes_driver_id_fkey(full_name),
          manifests(id, total_packages),
          route_receptions(expected_count)
        `)
        .eq('operator_id', operatorId!)
        .eq('status', status)
        .is('deleted_at', null)
        .order('in_transit_at', { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as PickupRouteWithRelations[];
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        driver_id: r.driver_id,
        driver_name: r.driver?.full_name ?? null,
        vehicle_label: r.vehicle_label,
        in_transit_at: r.in_transit_at,
        manifest_count: r.manifests?.length ?? 0,
        expected_packages:
          r.route_receptions?.[0]?.expected_count ??
          (r.manifests ?? []).reduce((sum, m) => sum + (m.total_packages ?? 0), 0),
      }));
    },
  });
}
