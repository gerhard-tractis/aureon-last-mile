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

// Exported (not just used internally) so dt-list-routes.ts can target the
// same tenant/base URL as Create Route without duplicating the env lookup.
export function dtBaseUrl(): string {
  const configured = process.env.DISPATCHTRACK_BASE_URL?.trim();
  return (configured || DEFAULT_DT_BASE_URL).replace(/\/+$/, '');
}

function toDateDMY(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * spec-79 H-1 (review round 6): bounds every DT call so a genuinely in-flight
 * request cannot outlive `DISPATCH_CLAIM_STALE_MS` (dispatch-retry-claim.ts,
 * 2 minutes) — the claim's staleness window is what lets a crashed request's
 * lock be reclaimed, and without a hard upper bound on how long a call can
 * run, "crashed" and "still legitimately working" are indistinguishable.
 * `dispatch-retry-claim.ts`'s own comment used to cite Vercel's serverless
 * function timeout for this; this repo also runs self-hosted (the QA VPS has
 * no such timeout), so the bound has to come from the fetch call itself, not
 * from the hosting platform. Exported so dt-list-routes.ts's own fetch shares
 * the same bound.
 */
export const DT_FETCH_TIMEOUT_MS = 30_000;

/**
 * Thrown only when DispatchTrack itself answered with a non-2xx HTTP status —
 * i.e. DT received the request and definitively rejected it. Distinguished
 * from every other failure mode (network error before any response, a
 * response that could not be parsed, an ok-but-unrecognisable body) so
 * callers can tell "DT said no" from "we don't know what DT did" — see
 * route.ts's outer catch, which only releases the dispatch claim on this
 * error (spec-79 H-1).
 */
export class DTRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DTRejectedError';
  }
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

  let response: Response;
  try {
    response = await fetch(
      `${dtBaseUrl()}/api/external/v1/routes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AUTH-TOKEN': apiToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DT_FETCH_TIMEOUT_MS),
      },
    );
  } catch (networkErr) {
    // Never received a response — DT may or may not have processed this
    // before the connection dropped/timed out. NOT a DTRejectedError: the
    // caller (route.ts) must not treat this as proof DT said no.
    throw new Error(`DT create route call failed before a response arrived — outcome unknown: ${String(networkErr)}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (parseErr) {
    throw new Error(`DT create route response could not be parsed — outcome unknown: ${String(parseErr)}`);
  }

  if (!response.ok) {
    const message = typeof (json as { response?: unknown })?.response === 'string'
      ? (json as { response: string }).response
      : `DT API error ${response.status}`;
    // DT answered with an explicit HTTP error — it received and rejected
    // this request. Safe to conclude no route was created.
    throw new DTRejectedError(message);
  }

  // A 2xx is not proof of a created route: DT also answers 208 "already
  // reported", and its error envelope puts a plain string in `response`.
  // Without this check `String(undefined)` would be stored as the route's
  // external_route_id and the route would look dispatched. Deliberately a
  // plain Error, not DTRejectedError — DT answered 2xx, so it did NOT reject
  // this request; the outcome is merely unclear, not a definite "no".
  const jsonObj = json as { response?: { route_id?: unknown }; status?: unknown } | null;
  const routeId = jsonObj?.response?.route_id;
  if (routeId === undefined || routeId === null) {
    throw new Error(
      `DT returned no route_id (status ${response.status}: ${JSON.stringify(jsonObj?.status ?? jsonObj)})`,
    );
  }

  return { external_route_id: String(routeId) };
}

// spec-79 B-2/B-3 (review round 6): the List Routes pre-check (pagination +
// full-manifest matching) is large enough on its own to push this file over
// the 300-line cap — moved to dt-list-routes.ts. Re-exported here so every
// existing import site (`from '@/lib/dispatchtrack-api'`) keeps working.
export { findExistingDTRoute, type DTRouteMatch } from './dt-list-routes';
