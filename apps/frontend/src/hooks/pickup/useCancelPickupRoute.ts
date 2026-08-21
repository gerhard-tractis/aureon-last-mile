import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { PickupRoute } from './useActivePickupRoute';

interface CancelArgs {
  routeId: string;
  /** Stored in `pickup_routes.cancellation_reason`. */
  reason?: string;
}

const DEFAULT_REASON = 'Cancelada por el líder de la ruta';

/**
 * Calls `cancel_pickup_route(p_route_id, p_reason)` — spec-61 Task 5's exit
 * for an abandoned route.
 *
 * Why this exists: `get_pending_manifests` stops offering routed loads
 * (Task 7), so a route opened by mistake — or one whose manifests all failed
 * to attach — takes its loads out of circulation with no way back. The RPC
 * and its type already existed (migration 20260812000003 PART 7); this is
 * the wiring, not new backend. The route-status trigger detaches the
 * manifests and nulls `reception_status`, so the loads return to the pending
 * list for anyone to claim — hence the `['pickup','manifests']`
 * invalidation, without which the leader sees no change at all.
 *
 * AUTHORISATION — READ BEFORE TRUSTING THIS: `cancel_pickup_route` checks
 * only that the route belongs to the caller's operator. It does NOT check
 * that the caller is the route's leader, and EXECUTE is granted to
 * `authenticated` (20260625000001:610). The "only the route's own leader may
 * cancel" rule in spec-61 is therefore enforced in the UI ONLY — any
 * authenticated user of the same operator can still cancel any open route by
 * calling the RPC directly. Closing that needs a migration and a decision
 * about whether admins/operations_managers keep the ability; spec-61 does
 * not settle it, so it is written down here rather than silently assumed.
 */
export function useCancelPickupRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<PickupRoute, Error, CancelArgs>({
    mutationFn: async ({ routeId, reason }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('cancel_pickup_route', {
        p_route_id: routeId,
        p_reason: reason ?? DEFAULT_REASON,
      });
      if (error) throw new Error(error.message);
      return data as PickupRoute;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
      qc.invalidateQueries({ queryKey: ['pickup', 'route-manifests'] });
      qc.invalidateQueries({ queryKey: ['pickup', 'manifests'] });
    },
  });
}
