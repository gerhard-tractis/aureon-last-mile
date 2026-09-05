import { dtBaseUrl, DT_FETCH_TIMEOUT_MS } from '@/lib/dispatchtrack-api';

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
 * network error.
 *
 * spec-79 B-3 (review round 6): a route is only ever considered a match when
 * it contains EVERY one of our guide identifiers (a superset, not merely an
 * intersection) — this identifies a specific ROUTE, not one of its orders.
 * `force_split` (spec-77 1b) deliberately lets one order hold live dispatches
 * on two routes at once, so the same guide identifier can legitimately
 * appear on an unrelated DT route that is not a duplicate of the one being
 * recovered; matching on "any shared identifier" aliased that unrelated
 * route's id onto ours. A DT route that only carries SOME of our
 * identifiers is not a candidate at all — it says nothing about whether OUR
 * route was already created. `ambiguous` now means "more than one DT route
 * fully contains our manifest," which should be near-impossible outside of
 * DT itself double-creating on its own end — still refused, never guessed.
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
 * Throws (never returns a false "not_found") on a non-ok response, a network
 * failure, an unrecognisable body shape, or an exhausted search — the
 * caller must treat a failed pre-check as unable to confirm safety, not as
 * permission to create.
 */
export async function findExistingDTRoute(
  params: { routeDate: string; identifiers: Array<string | number> },
  apiToken: string,
): Promise<DTRouteMatch> {
  const identifierSet = new Set(params.identifiers.map((v) => String(v)));

  type DTListedRoute = { id?: unknown; dispatches?: Array<{ identifier?: unknown }> };
  const allRoutes: DTListedRoute[] = [];

  for (let page = 1; page <= LIST_ROUTES_MAX_PAGES; page += 1) {
    let response: Response;
    try {
      response = await fetch(
        `${dtBaseUrl()}/api/external/v1/routes?date=${encodeURIComponent(params.routeDate)}`
          + `&page=${page}&limit=${LIST_ROUTES_PAGE_LIMIT}`,
        { headers: { 'X-AUTH-TOKEN': apiToken }, signal: AbortSignal.timeout(DT_FETCH_TIMEOUT_MS) },
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
    // B-3: a candidate must carry EVERY one of our identifiers, not merely
    // one — see this function's own header.
    const isFullMatch = [...identifierSet].every((id) => routeIdentifiers.has(id));
    if (isFullMatch && r?.id !== undefined && r?.id !== null) {
      matchedRouteIds.add(String(r.id));
    }
  }

  if (matchedRouteIds.size === 0) return { status: 'not_found' };
  if (matchedRouteIds.size > 1) return { status: 'ambiguous' };
  return { status: 'found', external_route_id: [...matchedRouteIds][0] };
}
