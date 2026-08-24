import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

type Manifest = Database['public']['Tables']['manifests']['Row'];

interface RemoveArgs {
  routeId: string;
  manifestId: string;
}

/**
 * Calls `remove_manifest_from_route(p_route_id, p_manifest_id)` — spec-64
 * Task 1's (migration 20260824000004) counterpart to `add_manifest_to_route`
 * (20260625000001, authorisation fixed in 20260822000001): undoes attaching a
 * carga to an open pickup route.
 *
 * Removal is refused once any package on the manifest has a verified pickup
 * scan, so this only ever takes back a carga that was never actually loaded
 * onto the truck — one already scanned in has no way back through this RPC.
 *
 * AUTHORISATION is enforced by the RPC, and it deliberately admits the same
 * callers as `add_manifest_to_route`: the route's own driver, an ACTIVE
 * `pickup_route_crew` member of that route, or operations_manager / admin /
 * super_admin. Crew ARE included here, unlike `cancel_pickup_route` (driver
 * or manager only) — loading the truck you ride is the job, ending someone
 * else's shift is not. This mirrors add so the two agree on who may touch a
 * route's manifest list.
 *
 * The guard is not a security perimeter: `authenticated` already holds
 * direct `UPDATE` on `manifests` under a `FOR ALL` tenant policy, so the RPC
 * is the supported path, not a boundary.
 *
 * The RPC's refusal message is Spanish on purpose (e.g. "Solo la tripulación
 * de esta ruta puede quitarle cargas.") because the page toasts err.message
 * verbatim — rethrown here unchanged, never wrapped or translated.
 */
export function useRemoveManifestFromRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<Manifest, Error, RemoveArgs>({
    mutationFn: async ({ routeId, manifestId }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('remove_manifest_from_route', {
        p_route_id: routeId,
        p_manifest_id: manifestId,
      });
      if (error) throw error;
      return data as Manifest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'route-manifests'] });
      qc.invalidateQueries({ queryKey: ['pickup', 'unassigned-manifests', operatorId] });
      qc.invalidateQueries({ queryKey: ['pickup', 'manifests'] });
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
    },
  });
}
