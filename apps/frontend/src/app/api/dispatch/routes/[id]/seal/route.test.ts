import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetSession, mockFrom, mockRpc } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

import { POST } from './route';

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][] }

interface Counts { total_stops: number; pending_stops: number; staged_stops: number; adopted_stops: number }

/**
 * `counts` is what route_stop_counts reports for the route, and `pending` the
 * rows the seal refusal has to name. Both are what the guard is made of, so
 * both are inputs to every test here.
 */
function buildClient(
  routeStatus: string | null,
  counts: Counts | null = { total_stops: 3, pending_stops: 0, staged_stops: 3, adopted_stops: 0 },
  pending: { order_id: string; orders: { order_number: string } }[] = [],
) {
  const ops: Op[] = [];
  mockFrom.mockImplementation((table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = vi.fn(self);
    chain.eq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.in = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.is = vi.fn(self);
    chain.update = vi.fn((p: Record<string, unknown>) => { op.kind = 'update'; op.payload = p; return chain; });
    chain.maybeSingle = chain.single = vi.fn(() =>
      Promise.resolve(
        table === 'routes'
          ? { data: routeStatus ? { id: 'route-1', status: routeStatus } : null, error: null }
          : { data: counts, error: null },
      ),
    );
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(
        table === 'dispatches' ? { data: pending, error: null } : { data: null, error: null },
      ).then(res, rej);
    return chain;
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
  return ops;
}

const params = Promise.resolve({ id: 'route-1' });
const req = () => new NextRequest('http://localhost/api/dispatch/routes/route-1/seal', { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: 'u-1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
    error: null,
  });
});

describe('POST /seal — a plan is a commitment', () => {
  /**
   * spec-70 decision 2. There is no auto-release: a stop the manager did not
   * explicitly remove has to go on the truck, so the seal refuses rather than
   * quietly shipping without it.
   */
  it('refuses while any stop is still merely planned', async () => {
    buildClient('loading', { total_stops: 5, pending_stops: 2, staged_stops: 3, adopted_stops: 0 }, [
      { order_id: 'o1', orders: { order_number: 'ORD-1' } },
      { order_id: 'o2', orders: { order_number: 'ORD-2' } },
    ]);

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('UNSEALED_STOPS');
    expect(json.pending_count).toBe(2);
    // Naming them is the difference between a refusal an operator can act on
    // and one they can only stare at.
    expect(json.pending).toEqual(expect.arrayContaining(['ORD-1', 'ORD-2']));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('seals when every stop is staged or adopted', async () => {
    buildClient('loading', { total_stops: 4, pending_stops: 0, staged_stops: 3, adopted_stops: 1 });

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({
      p_to_status: 'loaded',
    }));
  });

  it('advances the staged packages to listo_para_despacho', async () => {
    const ops = buildClient('loading', { total_stops: 1, pending_stops: 0, staged_stops: 1, adopted_stops: 0 },
      [{ order_id: 'o1', orders: { order_number: 'ORD-1' } }]);

    await POST(req(), { params });
    const pkg = ops.find((o) => o.table === 'packages' && o.kind === 'update');
    expect(pkg?.payload?.status).toBe('listo_para_despacho');
  });

  it('refuses to seal an empty route', async () => {
    buildClient('planned', { total_stops: 0, pending_stops: 0, staged_stops: 0, adopted_stops: 0 });

    const res = await POST(req(), { params });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('EMPTY_ROUTE');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  /** The button is at the dock and gets double-tapped. */
  it('is idempotent on an already-sealed route', async () => {
    buildClient('loaded', { total_stops: 2, pending_stops: 0, staged_stops: 2, adopted_stops: 0 });

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).already_sealed).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(['dispatched', 'in_transit', 'completed', 'cancelled'])(
    'refuses to seal a %s route',
    async (status) => {
      buildClient(status);
      const res = await POST(req(), { params });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('ROUTE_NOT_OPEN');
    },
  );

  it('404s for another operator\'s route', async () => {
    buildClient(null);
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
  });

  it('401s without a session', async () => {
    buildClient('loading');
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(req(), { params });
    expect(res.status).toBe(401);
  });
});
