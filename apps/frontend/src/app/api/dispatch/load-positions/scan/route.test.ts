import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetSession, mockFrom, mockValidatePositionScan } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFrom: vi.fn(),
  mockValidatePositionScan: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/dispatch/load-position-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dispatch/load-position-scan')>();
  return { ...actual, validatePositionScan: mockValidatePositionScan };
});

import { POST } from './route';

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][] }

/**
 * `routeStatus` seeds the review item 5 route-status guard's lookup —
 * mirrors `[id]/scan/route.test.ts`'s `buildClient` so both suites pin the
 * same gate the same way.
 */
function buildClient(routeStatus: string | null = 'loading') {
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
          : { data: null, error: null },
      ),
    );
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej);
    return chain;
  });
  return ops;
}

const STAGE_RESULT = {
  ok: true,
  dispatchId: 'd1',
  packageId: 'pkg-1',
  routeId: 'route-1',
  positionId: 'lp-1',
  positionCode: 'POS-04',
  package: {
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Mario',
    contact_address: 'Av 1',
    contact_phone: '+569',
  },
};

function makeReq(body: unknown = { packageCode: 'CTN-1', positionCode: "POS'04" }) {
  return new NextRequest('http://localhost/api/dispatch/load-positions/scan', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: 'u-1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
    error: null,
  });
});

describe('POST /api/dispatch/load-positions/scan', () => {
  it('401s with no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it('403s with no operator claim', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1', app_metadata: { claims: {} } } } },
      error: null,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
  });

  it('400s on a malformed body', async () => {
    buildClient();
    const res = await POST(makeReq({ packageCode: '' }));
    expect(res.status).toBe(400);
  });

  it('stages the dispatch, advances the package, and records the scan against the position', async () => {
    const ops = buildClient();
    mockValidatePositionScan.mockResolvedValue(STAGE_RESULT);

    const res = await POST(makeReq());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stage).toBe('staged');
    expect(body.package_status).toBe('en_carga');
    expect(body.order_id).toBe('o1');

    expect(mockValidatePositionScan).toHaveBeenCalledWith(expect.anything(), {
      packageCode: 'CTN-1',
      positionCode: "POS'04",
      operatorId: 'op-1',
    });

    const routeCheck = ops.find((o) => o.table === 'routes');
    expect(routeCheck?.filters).toContainEqual(['id', 'route-1']);
    expect(routeCheck?.filters).toContainEqual(['operator_id', 'op-1']);

    const dispatchUpdate = ops.find((o) => o.table === 'dispatches' && o.kind === 'update');
    expect(dispatchUpdate?.payload?.stage).toBe('staged');
    expect(dispatchUpdate?.payload?.staged_at).toBeTruthy();
    expect(dispatchUpdate?.payload?.staged_by).toBe('u-1');
    expect(dispatchUpdate?.filters).toContainEqual(['id', 'd1']);
    expect(dispatchUpdate?.filters).toContainEqual(['operator_id', 'op-1']);

    const pkgUpdate = ops.find((o) => o.table === 'packages' && o.kind === 'update');
    expect(pkgUpdate?.payload?.status).toBe('en_carga');
    expect(pkgUpdate?.filters).toContainEqual(['order_id', 'o1']);

    const dockScanInsert = ops.find((o) => o.table === 'dock_scans' && o.kind === 'insert');
    expect(dockScanInsert?.payload?.load_position_id).toBe('lp-1');
    expect(dockScanInsert?.payload?.package_id).toBe('pkg-1');
    expect(dockScanInsert?.payload?.scan_result).toBe('accepted');
    expect(dockScanInsert?.payload?.scanned_by).toBe('u-1');
    expect(dockScanInsert?.payload?.operator_id).toBe('op-1');
    // Ordinary andén scans leave load_position_id NULL — this write must
    // never also set dock_zone_id, or it would look like a sectorization
    // scan too.
    expect(dockScanInsert?.payload?.dock_zone_id).toBeUndefined();
  });

  it('422s with the reject reason when the scanned position does not match (wrong position)', async () => {
    buildClient();
    mockValidatePositionScan.mockResolvedValue({
      ok: false,
      code: 'POSITION_NOT_FOUND',
      message: 'Posición no encontrada',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('POSITION_NOT_FOUND');
    expect(body.message).toBe('Posición no encontrada');
  });

  it('422s when the package is not planned on the route occupying this position', async () => {
    buildClient();
    mockValidatePositionScan.mockResolvedValue({
      ok: false,
      code: 'NOT_PLANNED_FOR_POSITION',
      message: 'Este paquete no está planificado para la ruta de la posición POS-04',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('NOT_PLANNED_FOR_POSITION');
  });

  // Review item 5 — this handler had no route-status check at all before;
  // now it 409s exactly like [id]/scan/route.ts does for a sealed/dispatched
  // route, and performs no write.
  it('409s ROUTE_NOT_OPEN and writes nothing when the occupying route is already sealed', async () => {
    const ops = buildClient('loaded');
    mockValidatePositionScan.mockResolvedValue(STAGE_RESULT);

    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('ROUTE_NOT_OPEN');
    expect(body.message).toContain('loaded');

    expect(ops.find((o) => o.table === 'dispatches' && o.kind === 'update')).toBeUndefined();
    expect(ops.find((o) => o.table === 'packages' && o.kind === 'update')).toBeUndefined();
    expect(ops.find((o) => o.table === 'dock_scans' && o.kind === 'insert')).toBeUndefined();
  });

  it('404s when the route the position resolved to no longer exists for this operator', async () => {
    buildClient(null);
    mockValidatePositionScan.mockResolvedValue(STAGE_RESULT);

    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });
});
