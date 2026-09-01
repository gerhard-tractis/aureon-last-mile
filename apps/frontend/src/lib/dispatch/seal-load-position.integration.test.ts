import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sealLoadPosition } from './seal-load-position';

/**
 * spec-74 phase 3 — end-to-end proof that the POSITION seal (spec-71),
 * exercised through `sealLoadPosition`, refuses on the same partially_staged
 * / adopted-incomplete facts as the route-level seal.
 *
 * Unlike `seal-load-position.test.ts` (which mocks BOTH
 * `resolvePositionAndRoute` and `sealRoute` to test only the wiring between
 * them), this file mocks ONLY `resolvePositionAndRoute` and lets the REAL
 * `sealRoute` run against a fake Supabase client — the same shape
 * `seal-route.test.ts` uses directly. That is deliberate: `seal-route.test.ts`
 * proves sealRoute's new logic once; this file is the evidence that the
 * position seal is not a second, possibly-diverging copy of that logic — it
 * is the literal same function, imported unchanged from './seal-route'
 * (see seal-load-position.ts's own header, Decision 6 in
 * docs/specs/spec-74-per-bulto-staging.md).
 */

const mockResolvePositionAndRoute = vi.hoisted(() => vi.fn());
vi.mock('./load-position-resolve', () => ({
  resolvePositionAndRoute: mockResolvePositionAndRoute,
}));

interface Op { table: string; kind: string; filters: [string, unknown][] }

function buildClient(opts: {
  routeStatus?: string;
  counts?: {
    total_stops: number; pending_stops: number; partially_staged_stops: number;
    staged_stops: number; adopted_stops: number;
  };
  pendingRows?: { order_id: string; orders: { order_number: string } }[];
  adoptedRows?: { order_id: string; orders: { order_number: string } }[];
  outstandingPackages?: { order_id: string }[];
}) {
  const { routeStatus = 'loading', counts, pendingRows = [], adoptedRows = [], outstandingPackages = [] } = opts;
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn((table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.in = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.is = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.update = vi.fn(() => { op.kind = 'update'; return chain; });
    chain.maybeSingle = chain.single = vi.fn(() => {
      if (table === 'routes') return Promise.resolve({ data: { id: 'route-1', status: routeStatus }, error: null });
      return Promise.resolve({ data: counts, error: null });
    });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (table === 'dispatches') {
        const isAdoptedQuery = op.filters.some(([c, v]) => c === 'stage' && v === 'adopted');
        result = { data: isAdoptedQuery ? adoptedRows : pendingRows, error: null };
      } else if (table === 'packages' && op.kind !== 'update') {
        result = { data: outstandingPackages, error: null };
      }
      return Promise.resolve(result).then(res, rej);
    };
    return chain;
  });
  return { from, rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePositionAndRoute.mockResolvedValue({
    ok: true,
    position: { id: 'lp-1', code: 'POS-04' },
    routeId: 'route-1',
  });
});

describe('sealLoadPosition — real sealRoute, spec-74 phase 3 completeness', () => {
  it('refuses (UNSEALED_STOPS) when the occupying route has a partially_staged stop', async () => {
    const client = buildClient({
      counts: { total_stops: 2, pending_stops: 0, partially_staged_stops: 1, staged_stops: 1, adopted_stops: 0 },
      pendingRows: [{ order_id: 'o1', orders: { order_number: 'ORD-1' } }],
    });

    const result = await sealLoadPosition(client, { positionCode: 'POS-04', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSEALED_STOPS');
      expect(result.pending_count).toBe(1);
      expect(result.pending).toEqual(['ORD-1']);
    }
  });

  it('refuses (UNSEALED_STOPS) when the occupying route has an adopted dispatch with an outstanding package', async () => {
    const client = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      adoptedRows: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }],
      outstandingPackages: [{ order_id: 'o1' }],
    });

    const result = await sealLoadPosition(client, { positionCode: 'POS-04', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSEALED_STOPS');
      expect(result.pending).toEqual(['ORD-ADOPTED']);
    }
  });

  it('seals once the occupying route is fully staged', async () => {
    const client = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 1, adopted_stops: 0 },
    });

    const result = await sealLoadPosition(client, { positionCode: 'POS-04', operatorId: 'op-1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.already_sealed).toBe(false);
  });
});
