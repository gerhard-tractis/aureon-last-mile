import { createDTRoute } from '@/lib/dispatchtrack-api';
import {
  buildDtDispatches,
  findMissingOrderNumbers,
  findDispatchesWithNoLoadedItems,
  type DispatchRow,
} from '@/lib/dispatch/dispatch-dt-payload';
import { decidePrecheck } from '@/lib/dispatch/dispatch-retry-precheck';

/**
 * spec-79 Fase 4: extracted out of route.ts (which was about to cross the
 * 300-line cap) — everything that only runs when the route is NOT already a
 * confirmed retry (route.ts's `isConfirmedExternalRouteId` guard). Combines
 * the pre-DT validation chain (spec-79 phases 1-3: MISSING_ORDER_NUMBER,
 * EMPTY_MANIFEST, the DT token) with the Fase 4 GET pre-check
 * (`decidePrecheck`) that decides whether to reuse a route DT already has
 * or actually call `createDTRoute`.
 */
export type ResolveExternalRouteIdResult =
  | { ok: true; externalRouteId: string; isRetry: boolean }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
      count?: number;
      /** false only for RECONCILIATION_REQUIRED — see route.ts's own
       * comment at that call site for why releasing there would be unsafe. */
      release?: boolean;
    };

export async function resolveExternalRouteIdForDispatch(params: {
  dispatchRows: DispatchRow[];
  routeId: string;
  routeDate: string;
  truckIdentifier: string;
  driverIdentifier: string | null;
  wasStale: boolean;
  apiToken: string;
}): Promise<ResolveExternalRouteIdResult> {
  const { dispatchRows, routeId, routeDate, truckIdentifier, driverIdentifier, wasStale, apiToken } = params;

  const missingOrderNumbers = findMissingOrderNumbers(dispatchRows);
  if (missingOrderNumbers.length) {
    return {
      ok: false,
      code: 'MISSING_ORDER_NUMBER',
      status: 422,
      count: missingOrderNumbers.length,
      // RouteBuilder surfaces `message` verbatim.
      message: `${missingOrderNumbers.length} orden(es) de la ruta no tienen número de guía; no se puede despachar.`,
    };
  }

  // spec-79 B-1 (blocker): symmetric with EMPTY_ROUTE (route.ts), at the item
  // level. A stop can legitimately produce zero genuinely-loaded items;
  // createDTRoute then omits the `items` key instead of sending `[]`, so DT
  // got a guide with no contents and the handler answered `200 {ok:true}`
  // over it. Checked per stop — one empty stop among many still hands the
  // driver a stop with no contents.
  const emptyManifestDispatches = findDispatchesWithNoLoadedItems(dispatchRows, routeId);
  if (emptyManifestDispatches.length) {
    return {
      ok: false,
      code: 'EMPTY_MANIFEST',
      status: 422,
      count: emptyManifestDispatches.length,
      message: `${emptyManifestDispatches.length} parada(s) de la ruta no tienen bultos cargados; no se puede despachar.`,
    };
  }

  const dtDispatches = buildDtDispatches(dispatchRows, routeId);

  // spec-79 Fase 4, items 15-16: the GET pre-check runs ONLY when the claim
  // was a stale reclaim (`wasStale`) — some earlier attempt for this route
  // crashed with no chance to persist or release anything, so DT may
  // already have accepted it. On a fresh claim (genuine first attempt)
  // `decidePrecheck` skips it entirely — no round trip, no new failure
  // mode, and it would violate DT's own rate limit if run on every request
  // (Fase 0 finding 3).
  const decision = await decidePrecheck({
    wasStale,
    routeDate,
    identifiers: dtDispatches.map((d) => d.identifier),
    apiToken,
  });

  if (decision.action === 'refuse') {
    return {
      ok: false,
      code: 'RECONCILIATION_REQUIRED',
      status: 409,
      message:
        'No se pudo confirmar si esta ruta ya existe en DispatchTrack. Contactar soporte antes de reintentar.',
      // Deliberately false. The claim was already re-stamped to `now()` by
      // the stale reclaim, so it stays "fresh" for DISPATCH_CLAIM_STALE_MS —
      // the next attempt goes through this same stale-reclaim-then-precheck
      // path again instead of a bare fresh claim that would skip straight to
      // calling DT. See dispatch-retry-claim.ts's own release doc comment.
      release: false,
    };
  }

  if (decision.action === 'reuse') {
    // DT already has this route from an earlier, crashed attempt — reuse
    // its id instead of creating a second one. Functionally a retry from
    // here on: no createDTRoute, and the zero-loaded warn downstream must
    // not fire for it either.
    return { ok: true, externalRouteId: decision.externalRouteId, isRetry: true };
  }

  // decision.action === 'create': either the pre-check found nothing
  // (recovering a crashed attempt DT never actually saw) or it was skipped
  // entirely (genuine first attempt). Call DT API — if this throws, nothing
  // local has changed yet.
  const created = await createDTRoute({
    truck_identifier: truckIdentifier,
    route_date: routeDate,
    driver_identifier: driverIdentifier,
    dispatches: dtDispatches,
  }, apiToken);
  return { ok: true, externalRouteId: created.external_route_id, isRetry: false };
}
