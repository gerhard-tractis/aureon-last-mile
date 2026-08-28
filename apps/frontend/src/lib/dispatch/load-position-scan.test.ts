import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePositionByScannedCode, validatePositionScan } from './load-position-scan';

describe('resolvePositionByScannedCode', () => {
  const positions = [
    { id: 'lp-1', code: 'POS-04' },
    { id: 'lp-2', code: 'POS-05' },
  ];

  it('matches an exact scan', () => {
    const result = resolvePositionByScannedCode(positions, 'POS-04');
    expect(result).toEqual({ kind: 'one', position: positions[0] });
  });

  it('matches a scan with the layout-corrupted hyphen', () => {
    const result = resolvePositionByScannedCode(positions, "POS'04");
    expect(result).toEqual({ kind: 'one', position: positions[0] });
  });

  it('matches an unhyphenated scan', () => {
    const result = resolvePositionByScannedCode(positions, 'POS04');
    expect(result).toEqual({ kind: 'one', position: positions[0] });
  });

  it('returns kind none for no match', () => {
    expect(resolvePositionByScannedCode(positions, 'POS-99')).toEqual({ kind: 'none' });
  });

  it('never matches an all-punctuation scan that normalizes to empty', () => {
    expect(resolvePositionByScannedCode(positions, '---')).toEqual({ kind: 'none' });
  });

  // The mis-staging hazard this exists to catch: "POS-01" and "POS01" are
  // two legal, distinct rows (the unique constraint is on the RAW code),
  // but both normalize to "POS01". Picking one arbitrarily can stage a
  // package onto the wrong truck; this must surface as ambiguous instead.
  it('reports ambiguous when two distinct positions collide under normalization', () => {
    const colliding = [
      { id: 'lp-1', code: 'POS-01' },
      { id: 'lp-2', code: 'POS01' },
    ];
    const result = resolvePositionByScannedCode(colliding, 'POS01');
    expect(result).toEqual({ kind: 'ambiguous', positions: colliding });
  });
});

/**
 * validatePositionScan — mocked in the same style as scan-validator.test.ts:
 * one response per `.from(...)` call, in call order. `validateScan` itself
 * is mocked out here (it has its own suite) so these tests are only about
 * the position-resolution and occupancy wiring this file adds.
 */
const mockValidateScan = vi.hoisted(() => vi.fn());
vi.mock('./scan-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scan-validator')>();
  return { ...actual, validateScan: mockValidateScan };
});

interface Call { table: string; filters: [string, unknown][] }

function buildClient(responses: { data: unknown; error: { message: string } | null }[]) {
  const calls: Call[] = [];
  let i = 0;
  const from = vi.fn((table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const response = responses[i++] ?? { data: [], error: null };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((col: string, val: unknown) => { call.filters.push([col, val]); return chain; }),
      is: vi.fn((col: string, val: unknown) => { call.filters.push([col, val]); return chain; }),
      limit: vi.fn(() => Promise.resolve(response)),
      // `select(...)` on the positions table (no .limit chained) resolves
      // the query directly via `then`, like a real PostgREST builder.
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(response).then(res, rej),
    };
    return chain;
  });
  return { client: { from } as never, calls };
}

const POSITIONS = { data: [{ id: 'lp-1', code: 'POS-04' }], error: null };
const ROUTE = { data: [{ id: 'route-1' }], error: null };
const STAGE_OK = {
  ok: true,
  packageId: 'pkg-1',
  action: { kind: 'stage', dispatchId: 'd1' },
  package: {
    dispatch_id: '',
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Mario',
    contact_address: 'Av Principal 1',
    contact_phone: '+56912345678',
  },
};

const input = { packageCode: 'CTN-1', positionCode: "POS'04", operatorId: 'op-1' };

describe('validatePositionScan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the position despite the corrupted hyphen, resolves the occupying route, and stages', async () => {
    const { client, calls } = buildClient([POSITIONS, ROUTE]);
    mockValidateScan.mockResolvedValue(STAGE_OK);

    const result = await validatePositionScan(client, input);

    expect(calls[0].table).toBe('load_positions');
    // Review item 4 — pin every server-side filter, not just the one that
    // wires the resolved id through. Deleting any of these (e.g. the
    // operator_id scope, a cross-tenant leak, or the occupancy predicate's
    // released/deleted guards) must fail this test, not slip through green.
    expect(calls[0].filters).toContainEqual(['operator_id', 'op-1']);
    expect(calls[0].filters).toContainEqual(['is_active', true]);
    expect(calls[0].filters).toContainEqual(['deleted_at', null]);

    expect(calls[1].table).toBe('routes');
    expect(calls[1].filters).toContainEqual(['operator_id', 'op-1']);
    expect(calls[1].filters).toContainEqual(['load_position_id', 'lp-1']);
    expect(calls[1].filters).toContainEqual(['load_position_released_at', null]);
    expect(calls[1].filters).toContainEqual(['deleted_at', null]);
    expect(mockValidateScan).toHaveBeenCalledWith(client, {
      code: 'CTN-1',
      routeId: 'route-1',
      operatorId: 'op-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dispatchId).toBe('d1');
      expect(result.packageId).toBe('pkg-1');
      expect(result.routeId).toBe('route-1');
      expect(result.positionId).toBe('lp-1');
      expect(result.positionCode).toBe('POS-04');
    }
  });

  it('rejects when no active position matches the scanned code', async () => {
    const { client } = buildClient([{ data: [], error: null }]);
    const result = await validatePositionScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POSITION_NOT_FOUND');
    expect(mockValidateScan).not.toHaveBeenCalled();
  });

  // Item 1 — the mis-staging hazard. Two distinct, legal positions (raw
  // codes differ, normalized keys collide) must never resolve to an
  // arbitrary winner: AMBIGUOUS_POSITION, and no write of any kind —
  // neither the route lookup nor validateScan is ever reached.
  it('reports AMBIGUOUS_POSITION and performs no write when the scan collides across positions', async () => {
    const COLLIDING = {
      data: [
        { id: 'lp-1', code: 'POS-01' },
        { id: 'lp-2', code: 'POS01' },
      ],
      error: null,
    };
    const { client, calls } = buildClient([COLLIDING]);
    const result = await validatePositionScan(client, { ...input, positionCode: 'POS01' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AMBIGUOUS_POSITION');
      expect(result.message).toContain('POS-01');
      expect(result.message).toContain('POS01');
    }
    // Only the positions query ran — no route lookup, no validateScan call,
    // no staging write.
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('load_positions');
    expect(mockValidateScan).not.toHaveBeenCalled();
  });

  it('rejects an all-punctuation scan as no-match rather than an accidental empty-key match', async () => {
    const { client } = buildClient([POSITIONS]);
    const result = await validatePositionScan(client, { ...input, positionCode: '---' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POSITION_NOT_FOUND');
    expect(mockValidateScan).not.toHaveBeenCalled();
  });

  it('rejects when the position exists but no live route occupies it', async () => {
    const { client } = buildClient([POSITIONS, { data: [], error: null }]);
    const result = await validatePositionScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POSITION_NOT_OCCUPIED');
    expect(mockValidateScan).not.toHaveBeenCalled();
  });

  it('passes through a validateScan rejection (e.g. package not found)', async () => {
    const { client } = buildClient([POSITIONS, ROUTE]);
    mockValidateScan.mockResolvedValue({ ok: false, message: 'Código no encontrado', code: 'NOT_FOUND' });
    const result = await validatePositionScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('rejects a package that is not planned on the route occupying this position (adopt)', async () => {
    const { client } = buildClient([POSITIONS, ROUTE]);
    mockValidateScan.mockResolvedValue({
      ok: true,
      packageId: 'pkg-1',
      action: { kind: 'adopt' },
      package: STAGE_OK.package,
    });
    const result = await validatePositionScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_PLANNED_FOR_POSITION');
      expect(result.message).toContain('POS-04');
    }
  });

  it('surfaces a failed positions query rather than reporting POSITION_NOT_FOUND', async () => {
    const { client } = buildClient([{ data: null, error: { message: 'boom' } }]);
    const result = await validatePositionScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUERY_FAILED');
  });

  it('surfaces a failed routes query rather than reporting POSITION_NOT_OCCUPIED', async () => {
    const { client } = buildClient([POSITIONS, { data: null, error: { message: 'boom' } }]);
    const result = await validatePositionScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUERY_FAILED');
  });
});
