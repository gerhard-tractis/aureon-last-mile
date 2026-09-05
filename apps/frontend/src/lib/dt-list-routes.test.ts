import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findExistingDTRoute, LIST_ROUTES_WALK_BUDGET_MS } from './dt-list-routes';
import { DISPATCH_CLAIM_STALE_MS } from '@/lib/dispatch/dispatch-retry-claim';
import { DT_FETCH_TIMEOUT_MS } from '@/lib/dispatchtrack-api';

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

  /**
   * spec-79 H3 (review round 6, still surviving at round 7): removing
   * `signal: AbortSignal.timeout(...)` from this fetch left every existing
   * test passing.
   */
  it('bounds every page fetch with an AbortSignal (H3)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { routes: [] } }),
    });
    await findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token');
    const options = mockFetch.mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
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

  it('returns ambiguous when more than one DT route has a guide-identifier set exactly equal to ours', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: {
          routes: [
            { id: 111, dispatches: [{ identifier: '4821' }, { identifier: '4822' }] },
            { id: 222, dispatches: [{ identifier: '4821' }, { identifier: '4822' }] },
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

  /**
   * spec-79 B-1 (review round 7): round 6's B-3 fix required a DT route to
   * carry every one of our identifiers, but never checked the OPPOSITE
   * direction — a DT route carrying ALL of ours PLUS more (ours a subset of
   * theirs) was still accepted as `found`. That is exactly the shape
   * `force_split` produces in practice: the route being recovered (B) is
   * the small remainder, and the already-dispatched sibling (A) is the
   * LARGER route that happens to superset it. Aliasing A's external_route_id
   * onto B means B's manifest never reaches DispatchTrack.
   */
  it('does NOT match a DT route that carries all of our identifiers PLUS more (force_split: ours is the subset)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        response: {
          // Route A (already dispatched, DT id 88001): G-4471, G-5000, G-5001
          routes: [
            {
              id: 88001,
              dispatches: [{ identifier: 'G-4471' }, { identifier: 'G-5000' }, { identifier: 'G-5001' }],
            },
          ],
        },
      }),
    });
    // Route B (force_split remainder, recovering): G-4471 only.
    const result = await findExistingDTRoute(
      { routeDate: '2026-03-24', identifiers: ['G-4471'] },
      'token',
    );
    expect(result).toEqual({ status: 'not_found' });
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

  /**
   * spec-79 B-2 (review round 7): H-1.3's argument for the 2-minute claim
   * window ("each DT call is bounded at 30s, comfortably shorter") stopped
   * being true once one fetch became a serial loop of up to
   * LIST_ROUTES_MAX_PAGES (25) — worst case 750s. The walk must be bounded
   * by ONE shared deadline, not a fresh per-page timeout, so it cannot
   * outlive DISPATCH_CLAIM_STALE_MS (120s) and let two POSTs both stale-
   * reclaim and both call createDTRoute.
   */
  describe('B-2 (round 7): shared walk deadline, not a per-page timeout', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('the walk budget plus one createDTRoute call stays under DISPATCH_CLAIM_STALE_MS — checked, not just documented', () => {
      expect(LIST_ROUTES_WALK_BUDGET_MS + DT_FETCH_TIMEOUT_MS).toBeLessThan(DISPATCH_CLAIM_STALE_MS);
    });

    it('refuses (throws) once elapsed wall-clock time exceeds the shared walk budget, even though each individual page is well under DT_FETCH_TIMEOUT_MS', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-24T10:00:00.000Z'));

      const fullPage = Array.from({ length: 20 }, (_, i) => ({ id: i, dispatches: [{ identifier: `OTHER-${i}` }] }));
      // Each page "fetch" resolves instantly but simulates elapsed time by
      // advancing the system clock past the shared budget after page 1 —
      // exactly what a slow (but individually sub-30s) DT response would do
      // in production, without this test actually taking a minute.
      mockFetch.mockImplementation(async () => {
        vi.setSystemTime(new Date(Date.now() + LIST_ROUTES_WALK_BUDGET_MS + 1_000));
        return { ok: true, json: async () => ({ status: 'ok', response: { routes: fullPage } }) };
      });

      await expect(
        findExistingDTRoute({ routeDate: '2026-03-24', identifiers: ['4821'] }, 'token'),
      ).rejects.toThrow(/budget/);
      // Refuses after the SECOND page's deadline check — never reaches
      // LIST_ROUTES_MAX_PAGES (25) pages, proving the bound is the shared
      // deadline, not the page-count safety valve.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
