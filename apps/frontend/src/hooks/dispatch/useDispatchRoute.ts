import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DispatchRoute } from '@/lib/dispatch/types';

/**
 * spec-70 phase 4, breakage #3. RouteBuilder used to keep "closed" in a
 * `useState` that a page reload wiped — the route's real `status` column is
 * the only honest source for the header badge, whether the scan zone is
 * disabled, whether the manifest can still be sealed, and whether Despachar
 * is unlocked.
 */
export function useDispatchRoute(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'route', routeId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('routes')
        // truck_identifier isn't a real `routes` column — see useDispatchRoutes.ts,
        // which selects the same set. DispatchRoute types it because some other
        // read path resolves it via a join; not this one.
        .select('id, operator_id, external_route_id, route_date, driver_name, vehicle_id, status, planned_stops, completed_stops, created_at')
        .eq('id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .single();
      if (error) throw error;
      return data as DispatchRoute;
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 5_000,
  });
}
