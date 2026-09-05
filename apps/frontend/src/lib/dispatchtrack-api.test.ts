import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDTRoute, findExistingDTRoute, DTRejectedError, type DTRoutePayload } from './dispatchtrack-api';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

const payload: DTRoutePayload = {
  truck_identifier: 'ZALDUENDO',
  route_date: '2026-03-24',        // ISO — client converts to DD-MM-YYYY
  driver_identifier: null,
  dispatches: [
    {
      identifier: 4821,
      contact_name: 'Mario González',
      contact_address: 'Av. Providencia 1234',
      contact_phone: '+56912345678',
      contact_email: null,
      current_state: 1,
    },
  ],
};

describe('createDTRoute', () => {
  it('converts ISO date to DD-MM-YYYY before sending', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 164972 } }),
    });
    await createDTRoute(payload, 'test-token');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.date).toBe('24-03-2026');
  });

  it('sends X-AUTH-TOKEN header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'my-secret-token');
    expect(mockFetch.mock.calls[0][1].headers['X-AUTH-TOKEN']).toBe('my-secret-token');
  });

  it('returns external_route_id on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 164972 } }),
    });
    const result = await createDTRoute(payload, 'token');
    expect(result.external_route_id).toBe('164972');
  });

  it('throws with DT error message on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: 'Bad_request', response: 'Permission denied' }),
    });
    await expect(createDTRoute(payload, 'token')).rejects.toThrow('Permission denied');
  });

  /**
   * spec-79 H2 (review round 7): every prior test that touched
   * DTRejectedError constructed it from a hand-written `vi.mock` class in
   * the CALLER's test file — the real class this module exports was never
   * produced by any test. Import it for real here (this file never mocks
   * `./dispatchtrack-api` itself) so a mutant that replaces `throw new
   * DTRejectedError(...)` with `throw new Error(...)` is actually caught.
   */
  it('a non-ok response throws the real DTRejectedError, not a plain Error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: 'Bad_request', response: 'Permission denied' }),
    });
    await expect(createDTRoute(payload, 'token')).rejects.toBeInstanceOf(DTRejectedError);
  });

  /**
   * spec-79 H2: no test at all previously covered createDTRoute's own
   * network-failure branch — the "fetch never received a response" path
   * that route.ts's outer catch (H-1) must NOT treat as a definite
   * rejection. Must be a plain Error, never DTRejectedError.
   */
  it('throws a plain Error (never DTRejectedError) when fetch fails before any response arrives', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));
    const rejection = createDTRoute(payload, 'token');
    await expect(rejection).rejects.toThrow(/outcome unknown/i);
    await expect(rejection).rejects.not.toBeInstanceOf(DTRejectedError);
  });

  /**
   * spec-79 H2: no test covered the unparsable-body branch either — also
   * an "outcome unknown" case, never a definite rejection.
   */
  it('throws a plain Error (never DTRejectedError) when the response body cannot be parsed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });
    const rejection = createDTRoute(payload, 'token');
    await expect(rejection).rejects.toThrow(/outcome unknown/i);
    await expect(rejection).rejects.not.toBeInstanceOf(DTRejectedError);
  });

  /**
   * spec-79 H3 (review round 6, still surviving at round 7): removing
   * `signal: AbortSignal.timeout(...)` from the fetch call left every
   * existing test passing — nothing asserted it was ever there. Without it
   * a single stuck DT call has no upper bound, which is the entire premise
   * `DISPATCH_CLAIM_STALE_MS` relies on (dispatch-retry-claim.ts).
   */
  it('bounds the fetch with an AbortSignal (H-1.3 / H3): a stuck call must not hang forever', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'token');
    const options = mockFetch.mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits driver_identifier when null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute({ ...payload, driver_identifier: null }, 'token');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.driver_identifier).toBeUndefined();
  });
});

describe('createDTRoute — endpoint', () => {
  it('posts to the Musan tenant by default', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'token');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://transportesmusan.dispatchtrack.com/api/external/v1/routes',
    );
  });

  it('honours DISPATCHTRACK_BASE_URL so QA can point elsewhere', async () => {
    vi.stubEnv('DISPATCHTRACK_BASE_URL', 'https://sandbox.dispatchtrack.com');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'token');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://sandbox.dispatchtrack.com/api/external/v1/routes',
    );
    vi.unstubAllEnvs();
  });

  it('tolerates a trailing slash on the configured base URL', async () => {
    vi.stubEnv('DISPATCHTRACK_BASE_URL', 'https://sandbox.dispatchtrack.com/');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'token');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://sandbox.dispatchtrack.com/api/external/v1/routes',
    );
    vi.unstubAllEnvs();
  });
});

describe('createDTRoute - body shape', () => {
  it('omits optional contact fields that are null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute({
      ...payload,
      dispatches: [{
        identifier: 4821,
        contact_name: 'Mario',
        contact_address: null,
        contact_phone: null,
        contact_email: null,
        current_state: 1,
      }],
    }, 'token');
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body).dispatches[0];
    expect(sent).toEqual({ identifier: 4821, contact_name: 'Mario', current_state: 1 });
  });

  it('keeps optional contact fields that carry a value', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'token');
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body).dispatches[0];
    expect(sent.contact_address).toBe('Av. Providencia 1234');
    expect(sent.contact_phone).toBe('+56912345678');
  });

  it('throws when the response carries no route_id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'already reported', response: 'Route already exists' }),
    });
    await expect(createDTRoute(payload, 'token')).rejects.toThrow(/route_id/i);
  });
});

describe('createDTRoute - items', () => {
  it('sends the items array when the dispatch carries one', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute({
      ...payload,
      dispatches: [{
        identifier: 4821,
        contact_name: null,
        contact_address: null,
        contact_phone: null,
        contact_email: null,
        current_state: 1,
        items: [{ code: 'CTN-1', name: 'SKU-1', description: 'Caja', quantity: '2' }],
      }],
    }, 'token');
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body).dispatches[0];
    expect(sent.items).toEqual([
      { code: 'CTN-1', name: 'SKU-1', description: 'Caja', quantity: '2' },
    ]);
  });

  it('omits items entirely when there are none', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute({
      ...payload,
      dispatches: [{
        identifier: 4821,
        contact_name: null,
        contact_address: null,
        contact_phone: null,
        contact_email: null,
        current_state: 1,
        items: [],
      }],
    }, 'token');
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body).dispatches[0];
    expect('items' in sent).toBe(false);
  });
});

