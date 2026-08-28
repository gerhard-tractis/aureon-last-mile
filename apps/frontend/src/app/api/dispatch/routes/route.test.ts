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

/**
 * Routes mockRpc by function name so `create_seeded_route` resolves the
 * created route while `assign_load_position` (spec-71 phase 2, called right
 * after) resolves `null` — no position available — the best-effort default
 * these pre-existing tests don't care about. A single blanket
 * `mockResolvedValue` for both calls made `assign_load_position` "return" the
 * route object itself, which the handler then wrote back onto
 * `load_position_id` — a circular reference JSON.stringify chokes on.
 */
function mockRpcSeedThenNoPosition(seededRoute: unknown = DRAFT_ROUTE) {
  mockRpc.mockImplementation((fn: string) =>
    fn === 'create_seeded_route'
      ? Promise.resolve({ data: seededRoute, error: null })
      : Promise.resolve({ data: null, error: null }),
  );
}

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

    mockRpcSeedThenNoPosition();

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

/**
 * spec-70 phase 2.
 *
 * The route the wave produced has to carry the wave's date, and the
 * already-routed guard has to know about the lifecycle states phase 1 added —
 * otherwise an order sitting on a route that is mid-load or already at
 * DispatchTrack could be planned onto a second one.
 */
describe('POST /api/dispatch/routes — spec-70', () => {
  beforeEach(() => vi.clearAllMocks());

  function seedOk() {
    mockGetSession.mockResolvedValue(authedSession('op-1'));
    mockFrom
      .mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));
    mockRpcSeedThenNoPosition();
  }

  it('passes the wave date through to the RPC', async () => {
    seedOk();
    await POST(makePost({ order_ids: ['ord-1'], route_date: '2026-09-01' }));
    expect(mockRpc).toHaveBeenCalledWith('create_seeded_route', expect.objectContaining({
      p_route_date: '2026-09-01',
    }));
  });

  it('sends a null date when the caller gave none, so the DB decides', async () => {
    seedOk();
    await POST(makePost({ order_ids: ['ord-1'] }));
    expect(mockRpc).toHaveBeenCalledWith('create_seeded_route', expect.objectContaining({
      p_route_date: null,
    }));
  });

  it('rejects a malformed date rather than passing it to the DB', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));
    const res = await POST(makePost({ order_ids: ['ord-1'], route_date: '01-09-2026' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(['loading', 'loaded', 'dispatched', 'in_transit'])(
    'refuses to re-plan an order already on a %s route',
    async (status) => {
      mockGetSession.mockResolvedValue(authedSession('op-1'));
      mockFrom
        .mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }))
        .mockReturnValueOnce(
          makeChain({ data: [{ order_id: 'ord-1', route: { status } }], error: null }),
        );

      const res = await POST(makePost({ order_ids: ['ord-1'] }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('ORDERS_ALREADY_ROUTED');
      expect(mockRpc).not.toHaveBeenCalled();
    },
  );

  /** spec-43: a returned order's only history is a finished route. */
  it.each(['completed', 'cancelled'])(
    'lets an order whose only route is %s be planned again',
    async (status) => {
      mockGetSession.mockResolvedValue(authedSession('op-1'));
      mockFrom
        .mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }))
        .mockReturnValueOnce(
          makeChain({ data: [{ order_id: 'ord-1', route: { status } }], error: null }),
        );
      mockRpcSeedThenNoPosition();

      const res = await POST(makePost({ order_ids: ['ord-1'] }));
      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalled();
    },
  );
});

/**
 * spec-71 Decision 8: a seeded route reaches `planned` immediately, so it
 * gets a best-effort load-position assignment right after creation.
 */
describe('POST /api/dispatch/routes — spec-71 load position assignment', () => {
  beforeEach(() => vi.clearAllMocks());

  function seedRoute() {
    mockGetSession.mockResolvedValue(authedSession('op-1'));
    mockFrom
      .mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));
  }

  it('calls assign_load_position with the new route id right after create_seeded_route', async () => {
    seedRoute();
    mockRpcSeedThenNoPosition();

    await POST(makePost({ order_ids: ['ord-1'] }));

    expect(mockRpc).toHaveBeenCalledWith('assign_load_position', {
      p_route_id: 'route-1',
      p_operator_id: 'op-1',
      p_user_id: 'u-1',
    });
  });

  it('best-effort: no position available still returns 201 and never touches audit_logs', async () => {
    seedRoute();
    mockRpcSeedThenNoPosition(); // assign_load_position resolves { data: null }

    const res = await POST(makePost({ order_ids: ['ord-1'] }));
    expect(res.status).toBe(201);
    // Only the two ownership/routed-check from() calls — no third
    // (audit_logs) call, since nothing was assigned.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('writes an audit_logs row and echoes load_position_id when a position was assigned', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));
    mockRpc.mockImplementation((fn: string) =>
      fn === 'create_seeded_route'
        ? Promise.resolve({ data: DRAFT_ROUTE, error: null })
        : Promise.resolve({ data: 'pos-1', error: null }),
    );

    const auditInsertSpy = vi.fn().mockReturnValue({ then: (r: () => null) => r() });
    mockFrom
      .mockReturnValueOnce(makeChain({ data: [{ id: 'ord-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }))
      .mockReturnValueOnce({ insert: auditInsertSpy });

    const res = await POST(makePost({ order_ids: ['ord-1'] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.load_position_id).toBe('pos-1');

    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        user_id: 'u-1',
        action: 'assign_load_position',
        resource_type: 'routes',
        resource_id: 'route-1',
        changes_json: { load_position_id: 'pos-1' },
      }),
    );
  });

  it('a thrown/errored assign_load_position never fails route creation', async () => {
    seedRoute();
    mockRpc.mockImplementation((fn: string) =>
      fn === 'create_seeded_route'
        ? Promise.resolve({ data: DRAFT_ROUTE, error: null })
        : Promise.reject(new Error('boom')),
    );

    const res = await POST(makePost({ order_ids: ['ord-1'] }));
    expect(res.status).toBe(201);
  });

  it('does not assign a position for an empty draft route (draft, not planned)', async () => {
    mockGetSession.mockResolvedValue(authedSession('op-1'));
    mockFrom.mockReturnValue(makeChain({ data: DRAFT_ROUTE, error: null }));

    const res = await POST(makePost({}));
    expect(res.status).toBe(201);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
