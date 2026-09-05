import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findExistingDTRoute } from './dt-list-routes';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

/**
 * spec-79 Fase 4, Fase 0 finding 3: DT offers no idempotency key, but `GET
 * /routes?date=` can find a route already created there. Used ONLY on the
 * stale-reclaim retry path (dispatch-retry-claim.ts) — never on a first
 * attempt, per DT's own rate limit (1 req/sec, 1000/day). Matched by guide
 * (`dispatches[].identifier`) — never truck+date, since one truck can
 * legitimately run two routes the same day (Fase 0 finding 3's own caveat).
 */
describe('findExistingDTRoute', () => {
  it('sends the date in yyyy-mm-dd plus page/limit — List Routes documents yyyy-mm-dd, NOT dd-mm-yyyy like Create Route', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { routes: [] } }),
    });
    await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token');
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://transportesmusan.dispatchtrack.com/api/external/v1/routes?date=2026-03-24&page=1&limit=20',
    );
  });

  it('sends the X-AUTH-TOKEN header, no body (GET)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { routes: [] } }),
    });
    await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'my-token');
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ headers: { 'X-AUTH-TOKEN': 'my-token' } });
  });

  it('returns not_found when no route in the response carries any of our guide identifiers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: { routes: [{ id: 111, dispatches: [{ identifier: '9999' }] }] },
      }),
    });
    const result = await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns found with the matching route id when a DT route carries every one of our guide identifiers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: {
          routes: [
            { id: 111, dispatches: [{ identifier: '9999' }] },
            { id: 222, dispatches: [{ identifier: '4821' }, { identifier: '4822' }] },
          ],
        },
      }),
    });
    const result = await findExistingDTRoute(
      { routeDate: '2026-03-24', identifiers: ['4821', '4822'] },
      'token',
    );
    expect(result).toEqual({ status: 'found', external_route_id: '222' });
  });

  it('matches numeric identifiers against string identifiers (DT documents them as String)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: { routes: [{ id: 333, dispatches: [{ identifier: '4821' }] }] },
      }),
    });
    const result = await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: [4821] }, 'token');
    expect(result).toEqual({ status: 'found', external_route_id: '333' });
  });

  /**
   * spec-79 B-3 (review round 6): `force_split` (spec-77 1b) lets one order
   * hold live dispatches on two routes at once, so the SAME order_number can
   * legitimately appear on a DT route that has nothing to do with the route
   * being recovered. A DT route that carries only SOME of our identifiers
   * must never be aliased onto ours.
   */
  it('does NOT match a DT route that only carries SOME of our identifiers (force_split sibling order)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: {
          // Route A (already dispatched) shares order G-4471 with our route
          // B, via force_split — but does not carry B's OTHER order.
          routes: [{ id: 88001, dispatches: [{ identifier: 'G-4471' }] }],
        },
      }),
    });
    const result = await findExistingDTRoute(
      { routeDate: '2026-03-24', identifiers: ['G-4471', 'G-9001'] },
      'token',
    );
    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns ambiguous when more than one DT route fully contains our guide identifiers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: {
          routes: [
            { id: 111, dispatches: [{ identifier: '4821' }, { identifier: '4822' }] },
            { id: 222, dispatches: [{ identifier: '4821' }, { identifier: '4822' }, { identifier: '4823' }] },
          ],
        },
      }),
    });
    const result = await findExistingDTRoute(
      { routeDate: '2026-03-24', identifiers: ['4821', '4822'] },
      'token',
    );
    expect(result).toEqual({ status: 'ambiguous' });
  });

  it('throws (never fails open) on a non-ok response — Fase 0 finding 3: a failed pre-check must not read as "no duplicate"', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token'),
    ).rejects.toThrow();
  });

  it('throws on an unexpected response shape instead of silently reporting not_found', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', response: {} }) });
    await expect(
      findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token'),
    ).rejects.toThrow();
  });

  /**
   * spec-79 B-2 (review round 6): List Routes paginates (default limit 10,
   * range 10..20) and the old code sent neither `page` nor `limit`, so a
   * route past page 1 was invisible to the pre-check.
   */
  it('pages through multiple pages until a short page signals the end, aggregating matches across pages', async () => {
    const page1Routes = Array.from({ length: 20 }, (_, i) => ({
      id: 1000 + i,
      dispatches: [{ identifier: `OTHER-${i}` }],
    }));
    const page2Routes = [{ id: 555, dispatches: [{ identifier: '4821' }] }];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok', response: { routes: page1Routes } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok', response: { routes: page2Routes } }) });

    const result = await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token');

    expect(result).toEqual({ status: 'found', external_route_id: '555' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('page=1&limit=20');
    expect(mockFetch.mock.calls[1][0]).toContain('page=2&limit=20');
  });

  it('stops after one page when the first page is shorter than the limit', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { routes: [{ id: 1, dispatches: [{ identifier: '9999' }] }] } }),
    });
    await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses (throws) rather than guess when the search never reaches a short page within the page cap', async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) => ({ id: i, dispatches: [{ identifier: `OTHER-${i}` }] }));
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', response: { routes: fullPage } }) });
    await expect(
      findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token'),
    ).rejects.toThrow(/pages/);
  });
});
