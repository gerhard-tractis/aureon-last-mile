import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { PickupRoute } from './useActivePickupRoute';

interface StartArgs {
  /** `vehicles.id` — required. The route carries an FK, never free text. */
  vehicleId: string;
  /** spec-61 — `users.id` of everyone riding along, leader excluded. Omitted
   *  or empty is a solo route. */
  crewUserIds?: string[];
}

/**
 * Calls `start_pickup_route(p_vehicle_id, p_crew_user_ids)` and invalidates
 * the active-route query so the new row shows up in the banner immediately.
 *
 * spec-61: the crew is inserted by the RPC in the same transaction as the
 * route, so there is no second call to fail halfway and no window in which a
 * route exists with nobody on it.
 *
 * The RPC raises named Spanish errors — inactive / soft-deleted /
 * other-operator vehicle, "the driver already has an active route", "Solo un
 * líder…" and "… ya está en la ruta …" — so the message is rethrown verbatim
 * for the caller to surface. No mapping is added here: the RPC's message
 * already names the person and the route.
 */
export function useStartPickupRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<PickupRoute, Error, StartArgs>({
    mutationFn: async ({ vehicleId, crewUserIds }) => {
      const supabase = createSPAClient();
      // Always sent, never left to the SQL DEFAULT: one code path for a solo
      // route and a crewed one.
      const { data, error } = await supabase.rpc('start_pickup_route', {
        p_vehicle_id: vehicleId,
        p_crew_user_ids: crewUserIds ?? [],
      });
      if (error) throw new Error(error.message);
      return data as PickupRoute;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
    },
  });
}
