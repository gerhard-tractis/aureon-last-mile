import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

export type PickupRoute = Database['public']['Tables']['pickup_routes']['Row'];

/**
 * A route with its vehicle joined in.
 *
 * spec-52 moved the truck's identity off `pickup_routes.vehicle_label` (a free
 * text field) onto `vehicle_id -> vehicles.plate`. `vehicle_label` is still
 * written during the expand phase purely so the pre-switch UI would not go
 * blank, and it is dropped in the contract phase — so every read site takes
 * the plate from here. Null only if the vehicle row was removed.
 */
export type ActivePickupRoute = PickupRoute & {
  vehicle: { plate: string } | null;
};

/**
 * Returns the current `in_progress` pickup_routes row for the signed-in driver
 * within the active operator, or null if none. This is the single source of
 * truth for "does the driver have a route open right now?" — the pickup
 * landing page reads it to decide whether to render the banner + disable the
 * "Iniciar ruta" button. Refetches on window focus so a driver who closes a
 * route on one device sees the banner disappear on another.
 */
export function useActivePickupRoute(operatorId: string | null) {
  return useQuery<ActivePickupRoute | null>({
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
        .select('*, vehicle:vehicles(plate)')
        .eq('operator_id', operatorId!)
        .eq('driver_id', driverId)
        // `draft` is dead: start_pickup_route creates routes directly as
        // in_progress, and the DB's active-route indexes now cover only that.
        .eq('status', 'in_progress')
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      return (data?.[0] ?? null) as unknown as ActivePickupRoute | null;
    },
  });
}
