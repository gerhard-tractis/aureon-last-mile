'use client';

import { useRef, useState } from 'react';

/**
 * spec-77 Fase 2 — the client side of `POST /api/dispatch/routes/[id]/dispatch`
 * for `2j`. Deliberately NOT the same hook `RouteBuilder`/`3a`
 * (`useDispatchRouteToDispatchTrack.ts`) already share: that one collapses
 * every refusal down to `message ?? 'Error de DispatchTrack'`, discarding
 * `code` and `external_route_id` — exactly the flattening `2j` must not do
 * (spec-79's four review rounds distinguish `EMPTY_ROUTE`/`EMPTY_MANIFEST`/
 * `QUERY_FAILED`/`DT_API_ERROR`/`DT_ACCEPTED_LOCAL_FAILED` on purpose, and
 * the last one carries `external_route_id` in the body — see
 * `dispatch-review.ts`). Same one-shot shape as `useSealRoute.ts`.
 */
export interface DispatchRouteToDTInput {
  truckIdentifier: string;
  driverIdentifier?: string | null;
}

export interface DispatchRouteToDTOutcome {
  ok: boolean;
  code?: string | null;
  message?: string;
  externalRouteId?: string;
  packagesDispatched?: number;
}

export function useDispatchRouteToDT() {
  const [isDispatching, setIsDispatching] = useState(false);
  // Item 12 — a plain `isDispatching` boolean read by the caller is a
  // guard the CALLER can still race (two click handlers fired in the same
  // tick both read `isDispatching === false` before either setState
  // commits). This ref is checked and set synchronously inside `dispatch`
  // itself, so a second call in the same tick is refused here, not merely
  // discouraged by a disabled button upstream. This is a CLIENT guard only
  // — see this hook's own header and the endpoint's comments (spec-79
  // review finding 4) for why it does not close the server-side race
  // between two concurrent tabs/devices.
  const inFlight = useRef(false);

  const dispatch = async (
    routeId: string,
    input: DispatchRouteToDTInput,
  ): Promise<DispatchRouteToDTOutcome> => {
    if (inFlight.current) {
      return { ok: false, code: null, message: 'Ya se está despachando' };
    }
    inFlight.current = true;
    setIsDispatching(true);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          truck_identifier: input.truckIdentifier,
          driver_identifier: input.driverIdentifier ?? null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          code: json.code ?? null,
          message: json.message,
          externalRouteId: json.external_route_id,
        };
      }
      return {
        ok: true,
        externalRouteId: json.external_route_id,
        packagesDispatched: json.packages_dispatched,
      };
    } catch {
      return { ok: false, code: null, message: 'Error de red al despachar — intentá de nuevo' };
    } finally {
      inFlight.current = false;
      setIsDispatching(false);
    }
  };

  return { dispatch, isDispatching };
}
