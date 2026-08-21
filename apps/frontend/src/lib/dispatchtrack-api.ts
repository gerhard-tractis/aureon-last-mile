export interface DTDispatch {
  identifier: number;           // order number / guide number
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  current_state: 0 | 1;         // 0=in_preparation, 1=ready_to_go
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
