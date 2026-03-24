import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DispatchRoute } from '@/lib/dispatch/types';

export function useDispatchRoutes(operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'routes', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('routes')
        .select('id, status, route_date, driver_name, vehicle_id, planned_stops, completed_stops, created_at, external_route_id')
        .eq('operator_id', operatorId!)
        .in('status', ['draft', 'planned'])
        .eq('route_date', today)
        .is('deleted_at', null);
      if (error) throw error;
      return data as DispatchRoute[];
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
