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

interface Counts {
  total_stops: number;
  pending_stops: number;
  // spec-74 phase 3 — its own bucket on route_stop_counts (20260902000001).
  // Optional here (rather than required on every fixture) so every
  // pre-existing test in this file, which predates the value, keeps
  // meaning "no partially_staged dispatches" without being touched.
  partially_staged_stops?: number;
  staged_stops: number;
  adopted_stops: number;
}

/**
 * `counts` is what route_stop_counts reports for the route, `pending` the
 * rows the seal refusal has to name for a planned/partially_staged stop, and
 * `adoptedPending`/`outstandingPackages` (spec-74 phase 3) the equivalent
 * pair for an adopted dispatch's own completeness check — a SEPARATE query
 * pair `sealRoute` only issues when `adopted_stops > 0`, distinguished here
 * from the planned/partially_staged query by its `stage = 'adopted'` filter.
 */
interface PendingRow {
  id?: string;
  order_id: string;
  stage?: string;
  orders: { order_number: string };
}

function buildClient(
  routeStatus: string | null,
  counts: Counts | null = { total_stops: 3, pending_stops: 0, staged_stops: 3, adopted_stops: 0 },
  pending: PendingRow[] = [],
  opts: {
    routeError?: { code: string; message: string };
    countsError?: { code: string; message: string };
    adoptedPending?: { order_id: string; orders: { order_number: string } }[];
    outstandingPackages?: { order_id: string }[];
    releaseError?: { message: string };
  } = {},
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
    chain.insert = vi.fn((p: Record<string, unknown>) => { op.kind = 'insert'; op.payload = p; return chain; });
    chain.maybeSingle = chain.single = vi.fn(() => {
      if (table === 'routes') {
        return Promise.resolve(
          opts.routeError
            ? { data: null, error: opts.routeError }
            : { data: routeStatus ? { id: 'route-1', status: routeStatus } : null, error: null },
        );
      }
      return Promise.resolve(
        opts.countsError ? { data: null, error: opts.countsError } : { data: counts, error: null },
      );
    });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (table === 'dispatches') {
        if (op.kind === 'update') {
          result = { data: null, error: opts.releaseError ?? null };
        } else {
          const isAdoptedQuery = op.filters.some(([c, v]) => c === 'stage' && v === 'adopted');
          result = { data: isAdoptedQuery ? (opts.adoptedPending ?? []) : pending, error: null };
        }
      } else if (table === 'packages' && op.kind !== 'update') {
        result = { data: opts.outstandingPackages ?? [], error: null };
      }
      return Promise.resolve(result).then(res, rej);
    };
    return chain;
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
  return ops;
}

const params = Promise.resolve({ id: 'route-1' });
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/dispatch/routes/route-1/seal', {
    method: 'POST',
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  });

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

  /**
   * spec-74 phase 3 — the production failure this spec exists to fix, at the
   * HTTP layer: a 2-bulto order with one box scanned reads as
   * partially_staged, not staged, and the route-level seal (the one a
   * dispatcher is most likely to use, per spec-74 Decision 6) must refuse
   * it exactly like a fully-planned stop.
   */
  it('refuses (UNSEALED_STOPS) while any stop is partially_staged', async () => {
    buildClient('loading', { total_stops: 2, pending_stops: 0, partially_staged_stops: 1, staged_stops: 1, adopted_stops: 0 }, [
      { order_id: 'o1', orders: { order_number: 'ORD-1' } },
    ]);

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('UNSEALED_STOPS');
    expect(json.pending_count).toBe(1);
    expect(json.pending).toEqual(['ORD-1']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  /**
   * spec-74 phase 3 — the `adopted` finding, at the HTTP layer. An adopted
   * dispatch's `stage` never becomes partially_staged (it is preserved
   * forever, spec-74 phase 2 review item 3), so this refusal can only come
   * from the packages.loaded_at check — proving the route-level seal picks
   * it up too, not just the direct sealRoute unit tests.
   */
  it('refuses (UNSEALED_STOPS) when an adopted dispatch has an outstanding package', async () => {
    buildClient(
      'loading',
      { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      [],
      {
        adoptedPending: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }],
        outstandingPackages: [{ order_id: 'o1' }],
      },
    );

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('UNSEALED_STOPS');
    expect(json.pending_count).toBe(1);
    expect(json.pending).toEqual(['ORD-ADOPTED']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('seals a fully-loaded adopted dispatch (no outstanding package)', async () => {
    buildClient(
      'loading',
      { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      [],
      { adoptedPending: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }], outstandingPackages: [] },
    );

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({ p_to_status: 'loaded' }));
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

  /**
   * Review fix: the old builder left routes at `draft` through its whole scan
   * flow, and phase 1's backfill moved their dispatch rows straight to
   * `staged` without touching route status. Without `draft` in SEALABLE_FROM
   * every such route is unsealable and undispatchable forever from the
   * moment this deploys.
   */
  it('seals a legacy draft route', async () => {
    buildClient('draft', { total_stops: 2, pending_stops: 0, staged_stops: 2, adopted_stops: 0 });

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({
      p_to_status: 'loaded',
    }));
  });

  /**
   * A query that failed to run is not the same fact as "no such route" or
   * "no stops" — scan-validator.ts's header names exactly this confusion as
   * what hid three broken queries behind "Código no encontrado" for months.
   */
  it('reports a failed route lookup as QUERY_FAILED, not 404', async () => {
    buildClient('loading', undefined, undefined, { routeError: { code: '08006', message: 'connection reset' } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('QUERY_FAILED');
  });

  it('treats PGRST116 (no row matched) as a genuine 404, not QUERY_FAILED', async () => {
    buildClient('loading', undefined, undefined, { routeError: { code: 'PGRST116', message: 'no rows' } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
  });

  it('reports a failed route_stop_counts lookup as QUERY_FAILED, not EMPTY_ROUTE', async () => {
    buildClient('loading', undefined, undefined, { countsError: { code: '08006', message: 'connection reset' } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('QUERY_FAILED');
  });
});

/**
 * spec-77 — `force`. The FIRST test here re-proves, at the HTTP layer, that
 * an unforced request with pending stops is untouched: this endpoint is
 * exactly where the invariant being cut a hole in is enforced, so the pin
 * belongs here too, not only in `seal-route.test.ts`.
 */
describe('POST /seal — force (spec-77)', () => {
  it('PINNED: a plain POST (no body) with pending stops is unchanged', async () => {
    buildClient('loading', { total_stops: 5, pending_stops: 2, staged_stops: 3, adopted_stops: 0 }, [
      { order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } },
      { order_id: 'o2', stage: 'planned', orders: { order_number: 'ORD-2' } },
    ]);

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('UNSEALED_STOPS');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects force:true with no reason_code — 400 FORCE_REASON_REQUIRED', async () => {
    buildClient('loading', { total_stops: 1, pending_stops: 1, staged_stops: 0, adopted_stops: 0 }, [
      { id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } },
    ]);

    const res = await POST(req({ force: true }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('FORCE_REASON_REQUIRED');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a reason_code outside the closed vocabulary — 400 VALIDATION_ERROR', async () => {
    buildClient('loading', { total_stops: 1, pending_stops: 1, staged_stops: 0, adopted_stops: 0 }, [
      { id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } },
    ]);

    const res = await POST(req({ force: true, reason_code: 'porque_si' }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires a non-empty note when reason_code is 'otro'", async () => {
    buildClient('loading', { total_stops: 1, pending_stops: 1, staged_stops: 0, adopted_stops: 0 }, [
      { id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } },
    ]);

    const res = await POST(req({ force: true, reason_code: 'otro' }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('force with a valid reason releases the planned stop and seals', async () => {
    const ops = buildClient('loading', { total_stops: 2, pending_stops: 1, staged_stops: 1, adopted_stops: 0 }, [
      { id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } },
    ]);

    const res = await POST(req({ force: true, reason_code: 'paquete_no_ubicado', note: 'no está en A3' }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.forced).toEqual({
      reason_code: 'paquete_no_ubicado',
      note: 'no está en A3',
      released_count: 1,
    });
    expect(mockRpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({ p_to_status: 'loaded' }));

    const release = ops.find((o) => o.table === 'dispatches' && o.kind === 'update');
    expect(release?.payload?.removal_reason).toContain('paquete_no_ubicado');

    const audit = ops.find((o) => o.table === 'audit_logs');
    expect(audit?.payload).toMatchObject({ action: 'force_seal_route', user_id: 'u-1', operator_id: 'op-1' });
  });

  it('still refuses (UNSEALED_STOPS) when a partially_staged order is among the pending stops, even forced', async () => {
    buildClient('loading', { total_stops: 2, pending_stops: 0, partially_staged_stops: 1, staged_stops: 1, adopted_stops: 0 }, [
      { id: 'd1', order_id: 'o1', stage: 'partially_staged', orders: { order_number: 'ORD-1' } },
    ]);

    const res = await POST(req({ force: true, reason_code: 'turno_terminado' }), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('UNSEALED_STOPS');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
