import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { PickupRoute } from './useActivePickupRoute';

interface StartArgs {
  /** `vehicles.id` — required. The route carries an FK, never free text. */
  vehicleId: string;
}

/**
 * Calls `start_pickup_route(p_vehicle_id)` and invalidates the active-route
 * query so the new row shows up in the banner immediately.
 *
 * The RPC raises named Spanish errors — inactive / soft-deleted /
 * other-operator vehicle, and "the driver already has an active route" — so
 * the message is rethrown verbatim for the caller to surface.
 */
export function useStartPickupRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<PickupRoute, Error, StartArgs>({
    mutationFn: async ({ vehicleId }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('start_pickup_route', {
        p_vehicle_id: vehicleId,
      });
      if (error) throw new Error(error.message);
      return data as PickupRoute;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
    },
  });
}
