import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// vi.hoisted, because vi.mock factories are lifted above these declarations and
// the scan-validator factory is evaluated while route.ts is being imported —
// without it the run dies on "Cannot access 'mockValidateScan' before
// initialization" before a single test executes.
const { mockGetSession, mockFrom, mockRpc, mockValidateScan } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockValidateScan: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/dispatch/scan-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dispatch/scan-validator')>();
  return { ...actual, validateScan: mockValidateScan };
});

import { POST } from './route';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][] }

/**
 * Records every table operation so the assertions can be about what the
 * handler wrote, not merely that it returned 201. `routeStatus` seeds the
 * lookup the handler does to decide whether the route may still be loaded.
 */
function buildClient(routeStatus: string | null = 'planned') {
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
    chain.insert = vi.fn((p: Record<string, unknown>) => { op.kind = 'insert'; op.payload = p; return chain; });
    chain.update = vi.fn((p: Record<string, unknown>) => { op.kind = 'update'; op.payload = p; return chain; });
    chain.single = vi.fn(() =>
      Promise.resolve(
        table === 'routes'
          ? { data: routeStatus ? { id: 'route-1', status: routeStatus } : null, error: null }
          : { data: { id: 'new-dispatch' }, error: null },
      ),
    );
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej);
    return chain;
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
  return ops;
}

const PKG = {
  dispatch_id: '', order_id: 'o1', order_number: 'ORD-1',
  contact_name: 'Mario', contact_address: 'Av 1', contact_phone: '+569',
  package_status: 'en_carga' as const,
};

function makeReq(body: unknown = { code: 'CTN-1' }) {
  return new NextRequest('http://localhost/api/dispatch/routes/route-1/scan', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'route-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: 'u-1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
    error: null,
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /scan — staging a planned stop', () => {
  it('updates the seeded row rather than inserting a second one', async () => {
    const ops = buildClient('planned');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'stage', dispatchId: 'd1' } });

    const res = await POST(makeReq(), { params });
    expect(res.status).toBe(201);

    const dispatchOps = ops.filter((o) => o.table === 'dispatches');
    expect(dispatchOps.map((o) => o.kind)).toContain('update');
    expect(dispatchOps.map((o) => o.kind)).not.toContain('insert');

    const update = dispatchOps.find((o) => o.kind === 'update');
    expect(update?.payload?.stage).toBe('staged');
    expect(update?.payload?.staged_at).toBeTruthy();
    expect(update?.payload?.staged_by).toBe('u-1');
    expect(update?.filters).toContainEqual(['id', 'd1']);
    expect(update?.filters).toContainEqual(['operator_id', 'op-1']);
  });

  it('advances the packages of the order to en_carga', async () => {
    const ops = buildClient('planned');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'stage', dispatchId: 'd1' } });

    await POST(makeReq(), { params });
    const pkgOp = ops.find((o) => o.table === 'packages' && o.kind === 'update');
    expect(pkgOp?.payload?.status).toBe('en_carga');
    expect(pkgOp?.filters).toContainEqual(['order_id', 'o1']);
  });

  /**
   * planned_stops drifted because the seed set it to the order count and every
   * scan then added one. spec-70 derives the counts from route_stop_counts, so
   * the handler must not write it at all.
   */
  it('never touches planned_stops', async () => {
    const ops = buildClient('planned');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'stage', dispatchId: 'd1' } });

    await POST(makeReq(), { params });
    const wrote = ops.filter((o) => o.kind === 'update' && o.payload && 'planned_stops' in o.payload);
    expect(wrote).toEqual([]);
  });
});

describe('POST /scan — adopting an unplanned stop', () => {
  it('inserts a dispatch at stage adopted with a reason', async () => {
    const ops = buildClient('planned');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'adopt' } });

    const res = await POST(makeReq({ code: 'CTN-9', reason: 'llegó suelto del andén 3' }), { params });
    expect(res.status).toBe(201);

    const insert = ops.find((o) => o.table === 'dispatches' && o.kind === 'insert');
    expect(insert?.payload?.stage).toBe('adopted');
    expect(insert?.payload?.route_id).toBe('route-1');
    expect(insert?.payload?.order_id).toBe('o1');
    expect(insert?.payload?.adopted_reason).toBe('llegó suelto del andén 3');
    expect(insert?.payload?.staged_at).toBeTruthy();
  });

  it('records a default reason when the operator gave none', async () => {
    const ops = buildClient('planned');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'adopt' } });

    await POST(makeReq(), { params });
    const insert = ops.find((o) => o.table === 'dispatches' && o.kind === 'insert');
    expect(insert?.payload?.adopted_reason).toBeTruthy();
  });
});

describe('POST /scan — route lifecycle', () => {
  it('moves a planned route to loading on the first scan', async () => {
    buildClient('planned');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'stage', dispatchId: 'd1' } });

    await POST(makeReq(), { params });
    const targets = mockRpc.mock.calls
      .filter((c) => c[0] === 'transition_route_status')
      .map((c) => c[1].p_to_status);
    expect(targets).toEqual(['loading']);
  });

  /**
   * draft -> loading is not a legal edge. A manually created empty route has to
   * pass through planned, which is exactly what adding its first stop means.
   */
  it('walks a draft route through planned before loading', async () => {
    buildClient('draft');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'adopt' } });

    await POST(makeReq(), { params });
    const targets = mockRpc.mock.calls
      .filter((c) => c[0] === 'transition_route_status')
      .map((c) => c[1].p_to_status);
    expect(targets).toEqual(['planned', 'loading']);
  });

  it('does not transition a route that is already loading', async () => {
    buildClient('loading');
    mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'stage', dispatchId: 'd1' } });

    await POST(makeReq(), { params });
    expect(mockRpc.mock.calls.filter((c) => c[0] === 'transition_route_status')).toEqual([]);
  });

  it.each(['loaded', 'dispatched', 'in_transit', 'completed'])(
    'refuses to load onto a %s route',
    async (status) => {
      buildClient(status);
      mockValidateScan.mockResolvedValue({ ok: true, package: PKG, action: { kind: 'stage', dispatchId: 'd1' } });

      const res = await POST(makeReq(), { params });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('ROUTE_NOT_OPEN');
      expect(mockValidateScan).not.toHaveBeenCalled();
    },
  );

  it('404s when the route is not the caller operator\'s', async () => {
    buildClient(null);
    const res = await POST(makeReq(), { params });
    expect(res.status).toBe(404);
    expect(mockValidateScan).not.toHaveBeenCalled();
  });
});

describe('POST /scan — rejection passthrough', () => {
  it('returns the validator code and message unchanged', async () => {
    buildClient('planned');
    mockValidateScan.mockResolvedValue({
      ok: false, code: 'ALREADY_STAGED', message: 'Paquete ya cargado en esta ruta',
    });

    const res = await POST(makeReq(), { params });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('ALREADY_STAGED');
    expect(json.message).toBe('Paquete ya cargado en esta ruta');
  });

  it('401s without a session', async () => {
    buildClient('planned');
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(makeReq(), { params });
    expect(res.status).toBe(401);
  });
});
