import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { PickupRoute } from './useActivePickupRoute';

interface StartArgs {
  vehicleLabel?: string | null;
}

/**
 * Calls `start_pickup_route(p_vehicle_label)` and invalidates the
 * active-route query so the new row shows up in the banner immediately.
 */
export function useStartPickupRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<PickupRoute, Error, StartArgs>({
    mutationFn: async ({ vehicleLabel = null }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('start_pickup_route', {
        p_vehicle_label: vehicleLabel,
      });
      if (error) throw error;
      return data as PickupRoute;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
    },
  });
}
