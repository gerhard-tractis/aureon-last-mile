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
//
// spec-79 M-2 (round 8 mediums): this hook used to discard the response's
// `code` and store only `err.message ?? 'Error al despachar'` — a raw
// internal string (a fetch/AbortSignal message, DispatchTrack's own body
// text, whatever the endpoint happened to send) reached the operator
// verbatim on both surfaces that use it (RoutePanel/`1b`, DispatchTablet
// ActionBar/`3a`). `2j`/`2k` (mobile) already solve exactly this with
// `dispatchErrorCopy` (`dispatch-review.ts`), which deliberately never
// flattens distinct codes into one string — reused here instead of writing
// a third mapping.
import { useCallback, useState } from 'react';
import { dispatchErrorCopy, type DispatchErrorInfo } from '@/lib/dispatch/dispatch-review';

export interface DispatchRouteToDispatchTrackParams {
  truckIdentifier: string;
  driverIdentifier: string | null;
}

export function useDispatchRouteToDispatchTrack(routeId: string) {
  const [dispatching, setDispatching] = useState(false);
  const [errorInfo, setErrorInfo] = useState<DispatchErrorInfo | null>(null);

  const dispatch = useCallback(
    async ({ truckIdentifier, driverIdentifier }: DispatchRouteToDispatchTrackParams): Promise<boolean> => {
      setDispatching(true);
      setErrorInfo(null);
      try {
        const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ truck_identifier: truckIdentifier, driver_identifier: driverIdentifier }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErrorInfo(dispatchErrorCopy(json?.code ?? null, json?.message ?? null));
          return false;
        }
        return true;
      } catch {
        // No response reached us at all (network failure, request aborted)
        // — code is genuinely unknown, same as `2j`'s own network-failure
        // branch. `dispatchErrorCopy(null)` is the shared "verify" copy for
        // exactly this state, not a bespoke message here.
        setErrorInfo(dispatchErrorCopy(null, null));
        return false;
      } finally {
        setDispatching(false);
      }
    },
    [routeId],
  );

  return { dispatch, dispatching, errorInfo };
}
