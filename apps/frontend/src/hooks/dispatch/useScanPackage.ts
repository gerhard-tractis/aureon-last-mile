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
      // spec-76 review I5 — `useRoutePackagesByStop` (2h) keys its query
      // under a DIFFERENT prefix (`['dispatch','mobile',
      // 'route-packages-by-stop', routeId, operatorId]`) with its own
      // 10s `staleTime`. Without this, invalidating only the
      // `['dispatch','packages',...]` prefix above left 2h showing the
      // pre-scan manifest for up to 10s after a scan that had already
      // moved 2e's own counter — "Ver los 148" opened to a stale "147".
      queryClient.invalidateQueries({
        queryKey: ['dispatch', 'mobile', 'route-packages-by-stop', routeId, operatorId],
      });
      // spec-78 review C2 — same problem as I5 above, on a device that
      // makes it visible for the first time: `useRouteLoadBrief` (its own
      // `staleTime: 10_000`, no `refetchInterval`) is what feeds `3a`'s
      // "EN EL ANDÉN" count and the órdenes-incompletas fraction, and
      // nothing ever refetches it once mounted on 2c/3a — a phone doesn't
      // sit long enough after the first scan for that to be visible, but
      // a tablet left mounted for a whole shift shows a `pendingOnDock`
      // frozen at whatever was true before "Empezar a escanear" while the
      // counter beside it (this same mutation's own optimistic-refetch
      // packages count) keeps climbing. Same fix as 2h's.
      queryClient.invalidateQueries({
        queryKey: ['dispatch', 'mobile', 'route-load-brief', routeId, operatorId],
      });
    },
  });
}
