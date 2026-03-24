import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDTRoute, type DTRoutePayload } from './dispatchtrack-api';

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
