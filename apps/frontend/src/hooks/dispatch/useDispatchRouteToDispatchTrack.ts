'use client';

// apps/frontend/src/hooks/dispatch/useDispatchRouteToDispatchTrack.ts
//
// spec-78 review I1 — extracted verbatim out of RouteBuilder.tsx's own
// `handleDispatch` (the desktop `1b`/`RoutePanel` action) so `3a`'s tablet
// dispatch button calls the exact same request-building code instead of a
// hand-copied second version — the review's own finding was that the
// tablet's original inline copy could drift from this one (different
// payload key, different error string) with nothing to catch it. Both
// callers now own only their own confirmation UI and post-success
// navigation; this hook owns the endpoint contract.
import { useCallback, useState } from 'react';

export interface DispatchRouteToDispatchTrackParams {
  truckIdentifier: string;
  driverIdentifier: string | null;
}

export function useDispatchRouteToDispatchTrack(routeId: string) {
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(
    async ({ truckIdentifier, driverIdentifier }: DispatchRouteToDispatchTrackParams): Promise<boolean> => {
      setDispatching(true);
      setError(null);
      try {
        const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ truck_identifier: truckIdentifier, driver_identifier: driverIdentifier }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message ?? 'Error al despachar');
        return true;
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? 'Error de DispatchTrack');
        return false;
      } finally {
        setDispatching(false);
      }
    },
    [routeId],
  );

  return { dispatch, dispatching, error };
}
