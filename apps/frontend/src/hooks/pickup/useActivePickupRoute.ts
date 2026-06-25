import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

export type PickupRoute = Database['public']['Tables']['pickup_routes']['Row'];

/**
 * Returns the current `in_progress` pickup_routes row for the signed-in driver
 * within the active operator, or null if none. This is the single source of
 * truth for "does the driver have a route open right now?" — the pickup
 * landing page reads it to decide whether to render the banner + disable the
 * "Iniciar ruta" button. Refetches on window focus so a driver who closes a
 * route on one device sees the banner disappear on another.
 */
export function useActivePickupRoute(operatorId: string | null) {
  return useQuery<PickupRoute | null>({
    queryKey: ['pickup', 'active-route', operatorId],
    enabled: !!operatorId,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data: authData } = await supabase.auth.getUser();
      const driverId = authData.user?.id;
      if (!driverId) return null;

      const { data, error } = await supabase
        .from('pickup_routes')
        .select('*')
        .eq('operator_id', operatorId!)
        .eq('driver_id', driverId)
        .in('status', ['draft', 'in_progress'])
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      return (data?.[0] ?? null) as PickupRoute | null;
    },
  });
}
