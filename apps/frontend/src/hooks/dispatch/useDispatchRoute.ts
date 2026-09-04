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
/**
 * The route query's key, exported so every writer that changes a route's
 * status invalidates the same one.
 *
 * This is not ceremony: the key was previously written inline here and
 * nowhere else, so nothing in the repo invalidated it. A successful seal
 * moved the row to `loaded` and the UI went on rendering `loading` — breakage
 * #3 rebuilt out of new parts, the exact defect this phase exists to kill.
 * `operatorId` is part of the identity so a cached route cannot survive an
 * operator switch.
 */
export const dispatchRouteKey = (routeId: string | null, operatorId: string | null) =>
  ['dispatch', 'route', routeId, operatorId] as const;

/**
 * `enabled` (spec-75 phase 4) — defaults to `true`, so every pre-existing
 * caller (RouteBuilder) is unaffected. `DispatchRouteSurface` passes
 * `!isBelowLg` so a mobile session, once `useIsBelowLg`'s post-hydration
 * effect settles, stops re-running this desktop-only status read — the
 * same "gate the fetch, not just the render" shape `useRouteLoadBrief`
 * already uses for the mirror-image mobile-only case.
 */
export function useDispatchRoute(routeId: string | null, operatorId: string | null, enabled = true) {
  return useQuery({
    queryKey: dispatchRouteKey(routeId, operatorId),
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
    enabled: enabled && !!routeId && !!operatorId,
    staleTime: 5_000,
  });
}
