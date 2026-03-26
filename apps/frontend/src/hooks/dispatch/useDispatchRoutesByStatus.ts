import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DispatchRoute, RouteStatus } from '@/lib/dispatch/types';

export function useDispatchRoutesByStatus(
  operatorId: string | null,
  statuses: RouteStatus[],
  sinceDate?: string,
) {
  return useQuery({
    queryKey: ['dispatch', 'routes', operatorId, statuses, sinceDate],
    queryFn: async () => {
      const supabase = createSPAClient();
      let query = supabase
        .from('routes')
        .select('id, status, route_date, driver_name, vehicle_id, planned_stops, completed_stops, created_at, external_route_id')
        .eq('operator_id', operatorId!)
        .in('status', statuses)
        .is('deleted_at', null)
        .order('route_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (sinceDate) {
        query = query.gte('route_date', sinceDate);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as DispatchRoute[];
    },
    enabled: !!operatorId && statuses.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
