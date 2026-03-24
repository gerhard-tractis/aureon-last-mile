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

function toDateDMY(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

export async function createDTRoute(
  payload: DTRoutePayload,
  apiToken: string,
): Promise<DTRouteResult> {
  const body: Record<string, unknown> = {
    truck_identifier: payload.truck_identifier,
    date: toDateDMY(payload.route_date),
    dispatches: payload.dispatches,
  };

  if (payload.driver_identifier) {
    body.driver_identifier = payload.driver_identifier;
  }

  const response = await fetch(
    'https://activationcode.dispatchtrack.com/api/external/v1/routes',
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

  return { external_route_id: String(json.response.route_id) };
}
