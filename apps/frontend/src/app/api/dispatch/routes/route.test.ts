import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Supabase SSR mock ──────────────────────────────────────────────────────────
const mockGetSession = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

import { POST } from './route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function authedSession(operatorId = 'op-1') {
  return {
    data: {
      session: {
        user: { id: 'u-1', app_metadata: { claims: { operator_id: operatorId } } },
      },
    },
    error: null,
  };
}

function makePost(body: unknown = {}) {
  return new NextRequest('http://localhost/api/dispatch/routes', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Creates a thenable chain where the awaited result is `result` */
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.insert = vi.fn(self);
  chain.in = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.is = vi.fn(self);
  chain.not = vi.fn(self);
  chain.filter = vi.fn(self);
  chain.single = vi.fn(() => Promise.resolve(result));
  // Make the chain itself awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const DRAFT_ROUTE = { id: 'route-1', status: 'draft', route_date: '2026-04-23', created_at: '2026-04-23T12:00:00Z' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/dispatch/routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(makePost());
    expect(res.status).toBe(401);
  });

  it('returns 403 when session has no operator_id', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1', app_metadata: { claims: {} } } } },
      error: null,
    });
    const res = await POST(makePost());
    expect(res.status).toBe(403);
  });

  it('creates empty draft route when body has no order_ids (regression)', async () => {
    mockGetSession.mockResolvedValue(authedSession());
    mockFrom.mockReturnValue(makeChain({ data: DRAFT_ROUTE, error: null }));

    const res = await POST(makePost({}));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe('route-1');
    expect(data.status).toBe('draft');
    // Must NOT call rpc for empty body
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('creates empty draft route when order_ids is empty array', async () => {
    mockGetSession.mockResolvedValue(authedSession());
    mockFrom.mockReturnValue(makeChain({ data: DRAFT_ROUTE, error: null }));

    const res = await POST(makePost({ order_ids: [] }));
    expect(res.status).toBe(201);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('creates route and dispatches atomically via RPC when order_ids provided', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));

    // ownership check: both orders belong to op-1
    const ordersChain = makeChain({ data: [{ id: 'ord-1' }, { id: 'ord-2' }], error: null });
    // already-routed check: no active dispatches
    const dispatchesChain = makeChain({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(ordersChain)     // from('orders')
      .mockReturnValueOnce(dispatchesChain); // from('dispatches')

    mockRpc.mockResolvedValue({ data: DRAFT_ROUTE, error: null });

    const res = await POST(makePost({ order_ids: ['ord-1', 'ord-2'] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe('route-1');

    expect(mockRpc).toHaveBeenCalledWith('create_seeded_route', expect.objectContaining({
      p_operator_id: 'op-1',
      p_order_ids: ['ord-1', 'ord-2'],
    }));
  });

  it('returns 400 INVALID_ORDER_IDS with invalid_ids[] when an order belongs to a different operator', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));

    // ownership check: only ord-1 found (ord-99 doesn't belong to op-1)
    mockFrom.mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }));

    const res = await POST(makePost({ order_ids: ['ord-1', 'ord-99'] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('INVALID_ORDER_IDS');
    expect(data.invalid_ids).toContain('ord-99');
    expect(data.invalid_ids).not.toContain('ord-1');

    // No route must have been created
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 ORDERS_ALREADY_ROUTED with routed_ids[] when order is on an active route', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));

    // ownership check: both valid
    mockFrom.mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }));
    // already-routed check: ord-1 is on a draft route
    mockFrom.mockReturnValueOnce(
      makeChain({ data: [{ order_id: 'ord-1', route: { status: 'draft' } }], error: null }),
    );

    const res = await POST(makePost({ order_ids: ['ord-1'] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('ORDERS_ALREADY_ROUTED');
    expect(data.routed_ids).toContain('ord-1');

    // No route must have been created
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 500 and performs no partial write when create_seeded_route RPC fails', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));

    mockFrom.mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }));
    mockFrom.mockReturnValueOnce(makeChain({ data: [], error: null }));

    // Simulate DB failure inside the RPC
    mockRpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected' } });

    const res = await POST(makePost({ order_ids: ['ord-1'] }));
    expect(res.status).toBe(500);

    // The RPC was called exactly once — no separate inserts
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('create_seeded_route', expect.any(Object));
  });
});
