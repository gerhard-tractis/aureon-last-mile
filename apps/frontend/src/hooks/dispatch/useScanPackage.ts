import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScanApiResponse } from '@/lib/dispatch/types';
import { dispatchRouteKey } from './useDispatchRoute';

export function useScanPackage(routeId: string, operatorId: string | null = null) {
  const queryClient = useQueryClient();
  return useMutation({
    // Typed as ScanApiResponse, not RoutePackage: the endpoint's
    // `package_status` field is genuinely `packages.status`, a different
    // vocabulary from `RoutePackage.status` (`dispatches.status`) — see
    // ScanApiResponse's doc comment.
    mutationFn: async (code: string): Promise<ScanApiResponse> => {
      const res = await fetch(`/api/dispatch/routes/${routeId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      // spec-76 phase 4 (2f) — conflictingRouteId rides along for
      // ALREADY_IN_ROUTE; every other caller (RouteBuilder desktop) already
      // ignores unknown fields on this thrown object.
      if (!res.ok) throw { code: json.code, message: json.message, conflictingRouteId: json.conflictingRouteId };
      return json as ScanApiResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'packages', routeId] });
      // The scan handler walks draft -> planned -> loading, so the route row
      // changes underneath us. Without this the header badge still reads
      // "Borrador" through an entire load.
      queryClient.invalidateQueries({ queryKey: dispatchRouteKey(routeId, operatorId) });
    },
  });
}
