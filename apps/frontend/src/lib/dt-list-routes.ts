// spec-79 M1 (review round 7): imported from the leaf config module, NOT
// from '@/lib/dispatchtrack-api' — that file re-exports `findExistingDTRoute`
// FROM this one, so importing back from it here would be the circular import
// this fix exists to avoid. See dispatchtrack-config.ts's own header.
import { dtBaseUrl, DT_FETCH_TIMEOUT_MS } from '@/lib/dispatchtrack-config';
import { DISPATCH_CLAIM_STALE_MS } from '@/lib/dispatch/dispatch-retry-claim';

export type DTRouteMatch =
  | { status: 'not_found' }
  | { status: 'found'; external_route_id: string }
  | { status: 'ambiguous' };

// spec-79 B-2: List Routes documents `limit` as default 10, range 10..20 —
// use the top of the documented range to minimise the number of requests
// against DT's own 1 req/sec rate limit while paging through everything.
const LIST_ROUTES_PAGE_LIMIT = 20;
// Safety valve, not an expected ceiling: this tenant runs nowhere near 1000
// routes in a single day (DT's own daily rate limit). If DT ever returns a
// page that never shrinks below the limit this many times in a row, refuse
// rather than loop forever or silently give up and read as "not found".
const LIST_ROUTES_MAX_PAGES = 25;

/**
 * spec-79 B-2 (review round 7): H-1.3's argument for `DT_FETCH_TIMEOUT_MS`
 * bounding a SINGLE fetch used to be enough to justify `DISPATCH_CLAIM_
 * STALE_MS` — "each DT call is bounded at 30s, comfortably under the claim's
 * 2-minute window". That stopped being true the moment one fetch became a
 * serial loop of up to `LIST_ROUTES_MAX_PAGES` (25) — worst case 750s, six
 * times the claim window, and just 5 slow pages (150s) already exceeds it.
 * Two POSTs can then both stale-reclaim, both see `not_found`, and both call
 * `createDTRoute` — two routes at DispatchTrack for one manifest.
 *
 * The fix bounds the WHOLE WALK with a single shared deadline, not each
 * fetch individually: `walkDeadline` is computed once before the loop, and
 * every page's own `AbortSignal.timeout` is capped to whatever remains of
 * it. Budget left deliberately generous below `DISPATCH_CLAIM_STALE_MS` —
 * `createDTRoute` still has to run afterward on a `not_found` result (also
 * `DT_FETCH_TIMEOUT_MS`-bounded), plus this handler's own DB writes. The
 * assertion right below makes that margin explicit and CHECKED, not just
 * documented, so a future change to either constant cannot silently reopen
 * B-2 — see this module's own file-level assertion.
 */
export const LIST_ROUTES_WALK_BUDGET_MS = 60_000;

// Checked relationship, not merely a comment: the walk budget plus one
// subsequent createDTRoute call must stay comfortably under the claim's
// staleness window, with margin left over for the handler's own local DB
// writes — or the entire premise of bounding page fetches by a shared
// deadline (instead of trusting DISPATCH_CLAIM_STALE_MS to outlive an
// unbounded serial loop) is gone. Throws at import time, not silently.
if (LIST_ROUTES_WALK_BUDGET_MS + DT_FETCH_TIMEOUT_MS >= DISPATCH_CLAIM_STALE_MS) {
  throw new Error(
    'dt-list-routes: LIST_ROUTES_WALK_BUDGET_MS + DT_FETCH_TIMEOUT_MS must stay under DISPATCH_CLAIM_STALE_MS '
      + '(spec-79 B-2, review round 7) — a future change to one of these three constants broke that relationship.',
  );
}

/**
 * spec-79 Fase 0 finding 3 / Fase 4: `GET /api/external/v1/routes?date=`
 * — the only pre-check DT offers, since it has no idempotency key (Fase 0
 * finding 1). Used ONLY on the retry path (dispatch-retry-claim.ts's
 * stale-reclaim), never on a first attempt — DT's rate limit is 1
 * request/second, 1000/day.
 *
 * spec-79 B-2 (review round 6): List Routes paginates — `limit` defaults to
 * 10 and this module used to send neither `page` nor `limit`, so at real
 * volume the route being recovered could sit past page 1 and this "never
 * returns a false not_found" pre-check returned exactly that on the common
 * case. Pages through every page (`page`/`limit` query params, `limit=20`,
 * the top of DT's documented 10..20 range) until a page comes back shorter
 * than the limit (the last page) — aggregating every route seen across every
 * page before deciding. `LIST_ROUTES_MAX_PAGES` is a safety valve: an
 * exhausted search (more pages than that) REFUSES (throws), it does not fall
 * back to "not found" — Fase 0's own words, "a pre-check that fails open is
 * worse than none," apply just as much to an exhausted search as to a
 * network error. spec-79 B-2 (review round 7): the walk as a whole is ALSO
 * bounded by a single shared deadline (`LIST_ROUTES_WALK_BUDGET_MS`, see
 * this module's own top-level comment) — a per-page `DT_FETCH_TIMEOUT_MS`
 * alone let a slow-but-not-hung series of pages outlive
 * `DISPATCH_CLAIM_STALE_MS`.
 *
 * spec-79 B-3 (review round 6) / B-1 (review round 7): a route is only ever
 * considered a match when its set of guide identifiers is EXACTLY EQUAL to
 * ours — mutual containment, not containment in either direction alone —
 * this identifies a specific ROUTE, not one of its orders. `force_split`
 * (spec-77 1b) deliberately lets one order hold live dispatches on two
 * routes at once, so the same guide identifier can legitimately appear on
 * an unrelated DT route that is not a duplicate of the one being recovered.
 * Round 6 fixed the "any shared identifier" direction (a DT route carrying
 * only SOME of our identifiers) but left the opposite direction open: a DT
 * route carrying ALL of ours PLUS more (ours a subset of theirs) was still
 * accepted as `found` — and that is exactly the shape `force_split`
 * produces in practice, since the route being recovered is typically the
 * small remainder and the already-dispatched sibling is the larger route
 * that happens to superset it. Neither direction of pure containment is
 * safe; only equality identifies the SAME route rather than a route that
 * merely overlaps ours. `ambiguous` now means "more than one DT route has a
 * guide-identifier set exactly equal to ours," which should be
 * near-impossible outside of DT itself double-creating on its own end —
 * still refused, never guessed.
 *
 * Matched by GUIDE identifier (`dispatches[].identifier`, the same value
 * `buildDtDispatches` sends as `identifier`), never by truck+date — a truck
 * can legitimately run two routes the same day (Fase 0 finding 3's own
 * caveat).
 *
 * `date` goes out as `yyyy-mm-dd` — List Routes documents this format,
 * NOT the `dd-mm-yyyy` Create Route uses (Fase 0 finding 3's "date format
 * trap": swapping them silently returns an empty set, which reads as "no
 * duplicate" — failing open in the one check that must not).
 *
 * spec-79 M-4 (round 8 mediums): this is an offset walk (`page`/`limit`),
 * with no cursor and no dedupe key DT offers. `scripts/dt-api-docs.md`
 * documents an `order` param (default ASC) but never names the field it
 * sorts by, and List Routes' own envelope carries no `total`/count field at
 * all — only `status`/`response`/`response.routes[]` — so there is no direct
 * way to detect "the total changed mid-walk" the way the brief for this item
 * asks. What the walk sends `order=ASC` for is determinism WITHIN one walk
 * (an unstated default is not the same thing as a guaranteed one), not proof
 * against drift. If a route is deleted between two page fetches, every
 * later route shifts up by one position; offset pagination then silently
 * SKIPS exactly one route with no signal in either page's contents — this
 * cannot be detected from the response shape alone, and is registered as an
 * open risk in this spec's Riesgos section (same category as H5's paging
 * heuristic, needs real traffic or an API change, not more code). What CAN
 * be detected and refused on: an INSERTION shifts rows the other way, and
 * produces a route id repeated across two pages — direct proof the list
 * moved during this walk. Once the list is known to have moved in one
 * direction mid-walk, nothing rules out it also moved in the skip direction
 * elsewhere in the same walk, so ANY repeated id anywhere in the walk
 * refuses the whole search rather than silently deduping and proceeding as
 * if the walk were stable — Fase 0's own words again: "a pre-check that
 * fails open is worse than none."
 *
 * Throws (never returns a false "not_found") on a non-ok response, a network
 * failure, an unrecognisable body shape, an exhausted search, an exhausted
 * walk budget, or a route id repeated across pages — the caller must treat a
 * failed pre-check as unable to confirm safety, not as permission to create.
 */
export async function findExistingDTRoute(
  params: { routeDate: string; identifiers: Array<string | number> },
  apiToken: string,
): Promise<DTRouteMatch> {
  const identifierSet = new Set(params.identifiers.map((v) => String(v)));

  type DTListedRoute = { id?: unknown; dispatches?: Array<{ identifier?: unknown }> };
  const allRoutes: DTListedRoute[] = [];
  // spec-79 M-4: route ids seen so far across the whole walk, to detect a
  // route reappearing on a later page — see this module's own header.
  const seenRouteIds = new Set<string>();

  // spec-79 B-2 (review round 7): one shared deadline for the ENTIRE walk,
  // not a fresh `DT_FETCH_TIMEOUT_MS` per page — see this module's own
  // header for why a per-page timeout alone let the walk outlive
  // `DISPATCH_CLAIM_STALE_MS`.
  const walkDeadline = Date.now() + LIST_ROUTES_WALK_BUDGET_MS;

  for (let page = 1; page <= LIST_ROUTES_MAX_PAGES; page += 1) {
    const remainingMs = walkDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `DT list routes exceeded its ${LIST_ROUTES_WALK_BUDGET_MS}ms shared walk budget (page ${page}) — refusing to guess`,
      );
    }
    let response: Response;
    try {
      response = await fetch(
        `${dtBaseUrl()}/api/external/v1/routes?date=${encodeURIComponent(params.routeDate)}`
          + `&page=${page}&limit=${LIST_ROUTES_PAGE_LIMIT}&order=ASC`,
        // Each individual fetch is still capped at DT_FETCH_TIMEOUT_MS (a
        // single stuck request must not hang forever either), but never for
        // longer than what remains of the shared walk budget.
        { headers: { 'X-AUTH-TOKEN': apiToken }, signal: AbortSignal.timeout(Math.min(DT_FETCH_TIMEOUT_MS, remainingMs)) },
      );
    } catch (networkErr) {
      throw new Error(`DT list routes call failed before a response arrived (page ${page}): ${String(networkErr)}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (parseErr) {
      throw new Error(`DT list routes response could not be parsed (page ${page}): ${String(parseErr)}`);
    }

    if (!response.ok) {
      throw new Error(`DT list routes error ${response.status} (page ${page})`);
    }

    const routes = (json as { response?: { routes?: unknown } } | null)?.response?.routes;
    if (!Array.isArray(routes)) {
      throw new Error(`DT list routes returned an unexpected shape (no response.routes array, page ${page})`);
    }

    // spec-79 M-4: a route id seen on an earlier page reappearing here is
    // direct proof the underlying list moved during this walk (an insertion
    // shifted rows down across the page boundary). See this module's own
    // header for why that is treated as grounds to refuse the WHOLE walk,
    // not just to dedupe and continue.
    for (const r of routes) {
      const id = (r as { id?: unknown } | null)?.id;
      if (id === undefined || id === null) continue;
      const key = String(id);
      if (seenRouteIds.has(key)) {
        throw new Error(
          `DT list routes returned route id ${key} on more than one page (page ${page}) — `
            + 'the list changed mid-walk, refusing to guess whether another route was skipped',
        );
      }
      seenRouteIds.add(key);
    }

    allRoutes.push(...routes);

    if (routes.length < LIST_ROUTES_PAGE_LIMIT) {
      // Short page — this was the last one. Stop paging.
      break;
    }
    if (page === LIST_ROUTES_MAX_PAGES) {
      throw new Error(
        `DT list routes did not reach a final (short) page within ${LIST_ROUTES_MAX_PAGES} pages — refusing to guess`,
      );
    }
  }

  const matchedRouteIds = new Set<string>();
  for (const r of allRoutes) {
    const dispatches = Array.isArray(r?.dispatches) ? r.dispatches : [];
    const routeIdentifiers = new Set(dispatches.map((d) => String(d?.identifier)));
    // B-1 (round 7): a candidate must carry EXACTLY our set of identifiers —
    // same size, mutual containment — not merely a superset or a subset.
    // See this function's own header.
    const isExactMatch =
      routeIdentifiers.size === identifierSet.size
      && [...identifierSet].every((id) => routeIdentifiers.has(id));
    if (isExactMatch && r?.id !== undefined && r?.id !== null) {
      matchedRouteIds.add(String(r.id));
    }
  }

  if (matchedRouteIds.size === 0) return { status: 'not_found' };
  if (matchedRouteIds.size > 1) return { status: 'ambiguous' };
  return { status: 'found', external_route_id: [...matchedRouteIds][0] };
}
