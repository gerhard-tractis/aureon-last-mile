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

  const dtDispatches = buildDtDispatches(dispatchRows, routeId);

  // spec-79 M-3 (round 8 mediums): on the stale-reclaim path, the GET
  // pre-check MUST run before the EMPTY_MANIFEST refusal below, not after.
  // Scenario this closes: attempt 1 reaches DT and crashes before anything
  // local is written; a box is damaged/withdrawn (retenido/dañado) before the
  // retry. Under the old order, EMPTY_MANIFEST evaluated the CURRENT local
  // manifest first, saw zero genuinely-loaded packages, refused with 422 and
  // released the claim — and the pre-check that would have found DT's own
  // live copy of the route (created before the box was damaged) never ran.
  // The claim release then lets a later attempt reclaim fresh and call
  // createDTRoute directly, skipping the pre-check a second time too — DT
  // keeps an orphan route with no local record of it ever existing. Running
  // `decidePrecheck` first on the stale path means: `reuse` short-circuits
  // before EMPTY_MANIFEST can even be evaluated (the local manifest being
  // empty right now is irrelevant — DT already has the real one from before
  // the damage), `refuse` still refuses to RECONCILIATION_REQUIRED without
  // releasing (unchanged), and only `create` (pre-check confirms DT does NOT
  // already have this route) falls through to the EMPTY_MANIFEST check below
  // — the local manifest being empty is a real refusal only once the
  // pre-check has ruled out DT already holding a real one.
  //
  // `dtDispatches`' identifiers do not depend on which packages are loaded
  // (buildDtDispatches keys off order_number, not package state), so
  // computing them before EMPTY_MANIFEST is evaluated is safe even when the
  // manifest turns out to be empty.
  //
  // On a fresh claim (`wasStale: false`, genuine first attempt) the pre-check
  // must never run before EMPTY_MANIFEST or at all — no earlier attempt
  // reached DT, so there is nothing to reconcile, and calling DT here would
  // both add a needless round trip and violate its rate limit (Fase 0
  // finding 3). `decidePrecheck` is simply not called on that path.
  if (wasStale) {
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
        // the stale reclaim, so it stays "fresh" for DISPATCH_CLAIM_STALE_MS
        // — the next attempt goes through this same stale-reclaim-then-
        // precheck path again instead of a bare fresh claim that would skip
        // straight to calling DT. See dispatch-retry-claim.ts's own release
        // doc comment.
        release: false,
      };
    }

    if (decision.action === 'reuse') {
      // DT already has this route from an earlier, crashed attempt — reuse
      // its id instead of creating a second one. Functionally a retry from
      // here on: no createDTRoute, and the zero-loaded warn downstream must
      // not fire for it either. The local manifest being empty right now
      // (if it is) is irrelevant here — see this block's own header comment.
      return { ok: true, externalRouteId: decision.externalRouteId, isRetry: true };
    }

    // decision.action === 'create': the pre-check confirmed DT does not
    // already have this route. Fall through to EMPTY_MANIFEST + createDTRoute
    // below, same as the fresh-claim path.
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

  // Either a genuine first attempt (wasStale: false), or a stale reclaim
  // whose pre-check already confirmed `create` above. Call DT API — if this
  // throws, nothing local has changed yet.
  const created = await createDTRoute({
    truck_identifier: truckIdentifier,
    route_date: routeDate,
    driver_identifier: driverIdentifier,
    dispatches: dtDispatches,
  }, apiToken);
  return { ok: true, externalRouteId: created.external_route_id, isRetry: false };
}
