import { useQueryClient } from '@tanstack/react-query';
import { dispatchRouteKey } from './useDispatchRoute';

/**
 * Re-read the route row after a mutation that changes `routes.status`.
 *
 * spec-70 phase 4 made every affordance in the route builder derive from the
 * persisted status, which is correct — but it left the cached copy with no
 * writer. Sealing returned 200, the row moved to `loaded`, and the UI went on
 * rendering `loading`: the badge, "Cerrar ruta" and "Despachar" all stuck in
 * the pre-seal state, and a second tap just returned `already_sealed`. That is
 * breakage #3 (the UI's idea of "closed" drifting from the route row) rebuilt
 * out of new parts.
 *
 * Exists as a hook rather than an inline `invalidateQueries` so that the key
 * comes from one place and cannot drift from the query that owns it.
 */
export function useRefreshRouteStatus(routeId: string | null, operatorId: string | null) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: dispatchRouteKey(routeId, operatorId) });
}
