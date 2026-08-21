import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

export type PickupRoute = Database['public']['Tables']['pickup_routes']['Row'];

/** One person on the trip besides the leader (spec-61). */
export interface RouteCrewMember {
  user_id: string;
  full_name: string | null;
}

/** The RPC's payload: the route row, flattened, plus three joined extras. */
type ActiveRoutePayload = PickupRoute & {
  plate: string | null;
  driver_name: string | null;
  crew?: RouteCrewMember[] | null;
};

/**
 * A route with its vehicle and leader joined in.
 *
 * spec-52 moved the truck's identity off `pickup_routes.vehicle_label` (a free
 * text field) onto `vehicle_id -> vehicles.plate`. `vehicle_label` is still
 * written during the expand phase purely so the pre-switch UI would not go
 * blank, and it is dropped in the contract phase — so every read site takes
 * the plate from here. Null only if the vehicle row was removed.
 */
export type ActivePickupRoute = PickupRoute & {
  vehicle: { plate: string } | null;
  /** spec-54 3h redesign — `driver_id` joined against `public.users` for
   *  the header subtitle ("mié 13/08 · M. Rojas · PR-2026-0148") and the
   *  avatar initials. Null only if the user row was removed; the mobile
   *  header falls back to a placeholder rather than showing an id. */
  driver: { full_name: string } | null;
  /** spec-61 — everyone else on this trip. Empty for a solo route. */
  crew: RouteCrewMember[];
};

/**
 * The signed-in user's open pickup route — the one they LEAD or are active
 * CREW on — or null.
 *
 * spec-61 moved the resolution into `get_my_active_pickup_route()`. It used
 * to filter `driver_id = auth.uid()` here, which showed a crew member no
 * active route at all and dropped them on 3j, where they opened a SECOND
 * route for the same van. "Leader OR active crew" is an OR across a join and
 * PostgREST cannot express it in one request — see the migration header
 * (20260820000005) before considering a return to `.select()`.
 *
 * Refetches on window focus so someone who closes a route on one device sees
 * it disappear on another.
 */
export function useActivePickupRoute(operatorId: string | null) {
  return useQuery<ActivePickupRoute | null>({
    queryKey: ['pickup', 'active-route', operatorId],
    enabled: !!operatorId,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await callRpc<ActiveRoutePayload | null>(
        supabase,
        'get_my_active_pickup_route',
      );
      if (error) throw error;
      if (!data) return null;

      const { plate, driver_name, crew, ...route } = data;
      return {
        ...(route as PickupRoute),
        vehicle: plate ? { plate } : null,
        driver: driver_name ? { full_name: driver_name } : null,
        crew: crew ?? [],
      };
    },
  });
}
