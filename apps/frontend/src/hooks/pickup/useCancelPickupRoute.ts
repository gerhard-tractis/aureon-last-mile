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
 * AUTHORISATION: enforced by the RPC, in migration 20260821000001. Until
 * that migration `cancel_pickup_route` checked only the caller's operator —
 * with EXECUTE granted to `authenticated` (20260625000001:610), any user of
 * an operator could cancel any open route in it, including a pickup_crew
 * member killing their own leader's route mid-shift.
 *
 * It now admits the route's own `driver_id`, plus operations_manager / admin
 * / super_admin (who keep what they had, since an abandoned route has no
 * other in-app exit). A `pickup_leader` who does not drive the route gets
 * nothing — that is why this is NOT `ROUTE_LEADER_ROLES`, which answers the
 * different question of who may OPEN a route. The refusal is Spanish and is
 * rethrown verbatim below. The UI gate at the call sites stays as defence in
 * depth; the server is the authority.
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
