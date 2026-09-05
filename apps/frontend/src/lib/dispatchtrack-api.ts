/**
 * One line of a guide's contents. DT types `quantity` as String and its own
 * example sends it quoted, so it goes out as a string even though it counts
 * things.
 */
export interface DTItem {
  /** Unique code for the item. We put the package label here. */
  code: string;
  name?: string;
  description?: string;
  quantity?: string;
}

export interface DTDispatch {
  /**
   * Guide number — orders.order_number verbatim. Typed Integer in DT's docs,
   * but its webhooks send it as a string and Musan's guide format follows the
   * client, so it is not always numeric. Both forms go through as-is.
   */
  identifier: number | string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  current_state: 0 | 1;         // 0=in_preparation, 1=ready_to_go
  /** Guide contents. Omitted from the request when empty. */
  items?: DTItem[];
}

export interface DTRoutePayload {
  truck_identifier: string;
  route_date: string;           // ISO YYYY-MM-DD — converted internally to DD-MM-YYYY
  driver_identifier: string | null;
  dispatches: DTDispatch[];
}

export interface DTRouteResult {
  external_route_id: string;
}

/**
 * DispatchTrack is tenant-per-subdomain. Transportes Musan is the only tenant
 * this product talks to, and it is the host scripts/sync-pending-orders.mjs and
 * the dispatchtrack-route-poll edge function already use. This module posted to
 * `activationcode.dispatchtrack.com` instead — the placeholder subdomain from
 * DT's own API docs, which does not resolve, so dispatching could never have
 * worked from here.
 *
 * Overridable so QA can be aimed at a sandbox tenant if one is ever issued.
 * Read per call rather than at module load so the value tracks the environment.
 */
const DEFAULT_DT_BASE_URL = 'https://transportesmusan.dispatchtrack.com';

function dtBaseUrl(): string {
  const configured = process.env.DISPATCHTRACK_BASE_URL?.trim();
  return (configured || DEFAULT_DT_BASE_URL).replace(/\/+$/, '');
}

function toDateDMY(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

export async function createDTRoute(
  payload: DTRoutePayload,
  apiToken: string,
): Promise<DTRouteResult> {
  // Every contact_* field is optional in DT's Create Route contract, and its
  // own request example simply leaves absent ones out. Sending explicit nulls
  // is a guess about how DT treats them, so send only what we actually know.
  const body: Record<string, unknown> = {
    truck_identifier: payload.truck_identifier,
    date: toDateDMY(payload.route_date),
    dispatches: payload.dispatches.map((d) => {
      const dispatch: Record<string, unknown> = {
        identifier: d.identifier,
        current_state: d.current_state,
      };
      if (d.contact_name) dispatch.contact_name = d.contact_name;
      if (d.contact_address) dispatch.contact_address = d.contact_address;
      if (d.contact_phone) dispatch.contact_phone = d.contact_phone;
      if (d.contact_email) dispatch.contact_email = d.contact_email;
      if (d.items?.length) dispatch.items = d.items;
      return dispatch;
    }),
  };

  if (payload.driver_identifier) {
    body.driver_identifier = payload.driver_identifier;
  }

  const response = await fetch(
    `${dtBaseUrl()}/api/external/v1/routes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-TOKEN': apiToken,
      },
      body: JSON.stringify(body),
    },
  );

  const json = await response.json();

  if (!response.ok) {
    const message = typeof json?.response === 'string'
      ? json.response
      : `DT API error ${response.status}`;
    throw new Error(message);
  }

  // A 2xx is not proof of a created route: DT also answers 208 "already
  // reported", and its error envelope puts a plain string in `response`.
  // Without this check `String(undefined)` would be stored as the route's
  // external_route_id and the route would look dispatched.
  const routeId = json?.response?.route_id;
  if (routeId === undefined || routeId === null) {
    throw new Error(
      `DT returned no route_id (status ${response.status}: ${JSON.stringify(json?.status ?? json)})`,
    );
  }

  return { external_route_id: String(routeId) };
}

export type DTRouteMatch =
  | { status: 'not_found' }
  | { status: 'found'; external_route_id: string }
  | { status: 'ambiguous' };

/**
 * spec-79 Fase 0 finding 3 / Fase 4: `GET /api/external/v1/routes?date=`
 * — the only pre-check DT offers, since it has no idempotency key (Fase 0
 * finding 1). Used ONLY on the retry path (dispatch-retry-claim.ts's
 * stale-reclaim), never on a first attempt — DT's rate limit is 1
 * request/second, 1000/day.
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
 * Throws (never returns a false "not_found") on a non-ok response or an
 * unrecognisable body shape — the caller must treat a failed pre-check as
 * unable to confirm safety, not as permission to create. `ambiguous` (guide
 * identifiers split across more than one DT route) is likewise never
 * resolved automatically — see route.ts's RECONCILIATION_REQUIRED path.
 */
export async function findExistingDTRoute(
  params: { routeDate: string; identifiers: Array<string | number> },
  apiToken: string,
): Promise<DTRouteMatch> {
  const identifierSet = new Set(params.identifiers.map((v) => String(v)));

  const response = await fetch(
    `${dtBaseUrl()}/api/external/v1/routes?date=${encodeURIComponent(params.routeDate)}`,
    { headers: { 'X-AUTH-TOKEN': apiToken } },
  );
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`DT list routes error ${response.status}`);
  }

  const routes = json?.response?.routes;
  if (!Array.isArray(routes)) {
    throw new Error('DT list routes returned an unexpected shape (no response.routes array)');
  }

  const matchedRouteIds = new Set<string>();
  for (const r of routes) {
    const dispatches = Array.isArray(r?.dispatches) ? r.dispatches : [];
    const hasMatch = dispatches.some((d: { identifier?: unknown }) => identifierSet.has(String(d?.identifier)));
    if (hasMatch && r?.id !== undefined && r?.id !== null) {
      matchedRouteIds.add(String(r.id));
    }
  }

  if (matchedRouteIds.size === 0) return { status: 'not_found' };
  if (matchedRouteIds.size > 1) return { status: 'ambiguous' };
  return { status: 'found', external_route_id: [...matchedRouteIds][0] };
}
