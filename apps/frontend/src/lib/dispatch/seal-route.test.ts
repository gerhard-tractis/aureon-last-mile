import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sealRoute } from './seal-route';
import { DISPATCHABLE_STATUSES } from './scan-validator';

/**
 * spec-74 phase 3 — direct unit coverage of `sealRoute`'s new completeness
 * logic, isolated from the two HTTP handlers that call it
 * (`routes/[id]/seal/route.test.ts` and, through `sealLoadPosition`,
 * `load-positions/seal/route.test.ts` / `seal-load-position.test.ts`).
 * `sealRoute` itself is the ONE function both spec-70's route-level seal and
 * spec-71's position seal call (verified again in
 * `seal-load-position.test.ts`'s "resolves the position, then seals the
 * route occupying it" test, which asserts `sealRoute` is invoked with the
 * resolved route) — so proving the new logic here, once, is proving it for
 * both surfaces.
 */

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][] }

interface Counts {
  total_stops: number;
  pending_stops: number;
  partially_staged_stops: number;
  staged_stops: number;
  adopted_stops: number;
}

interface PendingRow {
  id: string;
  order_id: string;
  stage?: string;
  orders: { order_number: string };
}

const DEFAULT_COUNTS: Counts = {
  total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 1, adopted_stops: 0,
};

function buildClient(opts: {
  routeStatus?: string | null;
  counts?: Counts | null;
  pendingRows?: PendingRow[];
  adoptedRows?: { order_id: string; orders: { order_number: string } }[];
  outstandingPackages?: { order_id: string }[];
  /** spec-77 phase 1b — canned rows for `force-seal-split.ts`'s own
   * packages lookup, distinguished below from the adopted-completeness
   * query by the absence of a `status` filter (that query always has one). */
  splitPackages?: { id: string; order_id: string; status: string; loaded_at: string | null; load_inferred: boolean }[];
  adoptedError?: { message: string };
  outstandingError?: { message: string };
  releaseError?: { message: string };
} = {}) {
  const {
    routeStatus = 'loading',
    counts = DEFAULT_COUNTS,
    pendingRows = [],
    adoptedRows = [],
    outstandingPackages = [],
    splitPackages = [],
    adoptedError,
    outstandingError,
    releaseError,
  } = opts;

  const ops: Op[] = [];
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn((table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.in = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.is = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.update = vi.fn((p: Record<string, unknown>) => { op.kind = 'update'; op.payload = p; return chain; });
    chain.insert = vi.fn((p: Record<string, unknown>) => { op.kind = 'insert'; op.payload = p; return chain; });
    chain.maybeSingle = chain.single = vi.fn(() => {
      if (table === 'routes') {
        return Promise.resolve(
          routeStatus ? { data: { id: 'route-1', status: routeStatus }, error: null } : { data: null, error: null },
        );
      }
      return Promise.resolve({ data: counts, error: null });
    });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (table === 'dispatches') {
        if (op.kind === 'update') {
          result = { data: null, error: releaseError ?? null };
        } else {
          const isAdoptedQuery = op.filters.some(([c, v]) => c === 'stage' && v === 'adopted');
          result = isAdoptedQuery
            ? { data: adoptedError ? null : adoptedRows, error: adoptedError ?? null }
            : { data: pendingRows, error: null };
        }
      } else if (table === 'packages' && op.kind !== 'update') {
        const isAdoptedCompletenessQuery = op.filters.some(([c]) => c === 'status');
        result = isAdoptedCompletenessQuery
          ? (outstandingError ? { data: null, error: outstandingError } : { data: outstandingPackages, error: null })
          : { data: splitPackages, error: null };
      }
      return Promise.resolve(result).then(res, rej);
    };
    return chain;
  });
  return { client: { from, rpc } as never, ops, rpc };
}

beforeEach(() => vi.clearAllMocks());

describe('sealRoute — spec-74 phase 3 completeness', () => {
  /** The core write: a 2-bulto order partway staged refuses the seal. */
  it('refuses (UNSEALED_STOPS) while any dispatch is partially_staged', async () => {
    const { client, rpc } = buildClient({
      counts: { total_stops: 2, pending_stops: 0, partially_staged_stops: 1, staged_stops: 1, adopted_stops: 0 },
      pendingRows: [{ order_id: 'o1', orders: { order_number: 'ORD-1' } }],
    });

    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSEALED_STOPS');
      expect(result.pending_count).toBe(1);
      expect(result.pending).toEqual(['ORD-1']);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  /** The counterpart: once nothing is partially_staged or planned, it seals. */
  it('seals once every dispatch is staged (nothing planned or partially_staged)', async () => {
    const { client, rpc } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 1, adopted_stops: 0 },
    });

    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({ p_to_status: 'loaded' }));
  });

  /**
   * The pendingRows query must ask for BOTH stages now — the refusal has to
   * be able to name a partially_staged order, not just a planned one.
   */
  it('queries dispatches for planned OR partially_staged when naming pending stops', async () => {
    const { client, ops } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 1, staged_stops: 0, adopted_stops: 0 },
    });
    await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });

    const pendingOp = ops.find((o) => o.table === 'dispatches');
    expect(pendingOp?.filters).toContainEqual(['stage', ['planned', 'partially_staged']]);
  });

  /**
   * The `adopted` finding. dispatches.stage never becomes partially_staged
   * for an adopted row (stage-dispatch.ts preserves it), so pendingCount
   * alone cannot see this — the seal must check packages.loaded_at directly.
   */
  it('refuses (UNSEALED_STOPS) when an adopted dispatch has an outstanding package', async () => {
    const { client, rpc } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      adoptedRows: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }],
      outstandingPackages: [{ order_id: 'o1' }],
    });

    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSEALED_STOPS');
      expect(result.pending_count).toBe(1);
      expect(result.pending).toEqual(['ORD-ADOPTED']);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('seals a fully-loaded adopted dispatch (no outstanding package)', async () => {
    const { client, rpc } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      adoptedRows: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }],
      outstandingPackages: [],
    });

    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({ p_to_status: 'loaded' }));
  });

  /** No adopted rows at all — the adopted-completeness query must not run. */
  it('skips the adopted-completeness check entirely when adopted_stops is 0', async () => {
    const { client, ops } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 1, adopted_stops: 0 },
    });
    await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });

    const adoptedQuery = ops.find(
      (o) => o.table === 'dispatches' && o.filters.some(([c, v]) => c === 'stage' && v === 'adopted'),
    );
    expect(adoptedQuery).toBeUndefined();
  });

  it('reports a failed adopted-dispatches lookup as QUERY_FAILED', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      adoptedError: { message: 'connection reset' },
    });
    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUERY_FAILED');
    consoleError.mockRestore();
  });

  it('reports a failed outstanding-packages lookup as QUERY_FAILED', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      adoptedRows: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }],
      outstandingError: { message: 'connection reset' },
    });
    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUERY_FAILED');
    consoleError.mockRestore();
  });

  /**
   * spec-74 phase 3 review Fix 1 (BLOCKER). The adopted-completeness query
   * must intersect with DISPATCHABLE_STATUSES, the same set the scanner
   * itself accepts — otherwise a `dañado`/`retenido`/etc. sibling that can
   * NEVER be scanned pins the dispatch as "outstanding" forever and the
   * seal refuses permanently, with no way out. This asserts the query
   * SHAPE (the filter is present, with the exact scannable statuses); the
   * behavioural cases ("a dañado sibling does not block", "a sectorizado
   * sibling does") are proven where the real filtering happens —
   * `recompute_dispatch_stage`'s own pgTAP suite
   * (spec74_phase3_partially_staged.test.sql) for the planned/
   * partially_staged path, since this mock cannot itself apply a `.in()`
   * filter to canned data.
   */
  it('scopes the adopted-completeness query to DISPATCHABLE_STATUSES (Fix 1)', async () => {
    const { client, ops } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 1 },
      adoptedRows: [{ order_id: 'o1', orders: { order_number: 'ORD-ADOPTED' } }],
      outstandingPackages: [],
    });
    await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });

    const outstandingOp = ops.find((o) => o.table === 'packages');
    expect(outstandingOp).toBeTruthy();
    // spec-76 task 3 review, escalated decision — `en_bodega` came OUT of
    // DISPATCHABLE_STATUSES (it genuinely never reached the andén, so the
    // seal must not wait on it either, same reasoning as this test's own
    // comment for `dañado`/`retenido`). This assertion is intentionally
    // just `DISPATCHABLE_STATUSES` itself, not a hand-copied array, so it
    // cannot drift from that constant again.
    expect(outstandingOp?.filters).toContainEqual(['status', [...DISPATCHABLE_STATUSES]]);
    expect(outstandingOp?.filters).toContainEqual(['operator_id', 'op-1']);
    expect(outstandingOp?.filters).toContainEqual(['deleted_at', null]);
  });
});

/**
 * spec-77 — the force path. Spec-70 decision 2 ("a plan is a commitment")
 * is being cut a hole in on purpose, so the FIRST job here is proving the
 * unforced door is untouched: same status, same code, same refusal, nothing
 * written. Everything after that pins the new, narrower door.
 */
describe('sealRoute — force path (spec-77)', () => {
  it('PINNED: an unforced call with pending stops is unchanged — 409 UNSEALED_STOPS, nothing released, no audit', async () => {
    const { client, rpc, ops } = buildClient({
      counts: { total_stops: 1, pending_stops: 1, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 0 },
      pendingRows: [{ id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } }],
    });

    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSEALED_STOPS');
      expect(result.pending_count).toBe(1);
      expect(result.pending).toEqual(['ORD-1']);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(ops.find((o) => o.table === 'dispatches' && o.kind === 'update')).toBeUndefined();
    expect(ops.find((o) => o.table === 'audit_logs')).toBeUndefined();
  });

  it('refuses force with no reason code — 400 FORCE_REASON_REQUIRED, nothing released', async () => {
    const { client, rpc, ops } = buildClient({
      counts: { total_stops: 1, pending_stops: 1, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 0 },
      pendingRows: [{ id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } }],
    });

    const result = await sealRoute(client, { routeId: 'route-1', operatorId: 'op-1', force: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORCE_REASON_REQUIRED');
    expect(rpc).not.toHaveBeenCalled();
    expect(ops.find((o) => o.table === 'dispatches' && o.kind === 'update')).toBeUndefined();
  });

  it('refuses force with a reason code outside the closed vocabulary', async () => {
    const { client, rpc } = buildClient({
      counts: { total_stops: 1, pending_stops: 1, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 0 },
      pendingRows: [{ id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } }],
    });

    const result = await sealRoute(client, {
      routeId: 'route-1',
      operatorId: 'op-1',
      force: true,
      forceReasonCode: 'porque_si',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORCE_REASON_REQUIRED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('force with a valid reason releases the planned stop, seals, and audits', async () => {
    const { client, rpc, ops } = buildClient({
      counts: { total_stops: 2, pending_stops: 1, partially_staged_stops: 0, staged_stops: 1, adopted_stops: 0 },
      pendingRows: [{ id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } }],
    });

    const result = await sealRoute(client, {
      routeId: 'route-1',
      operatorId: 'op-1',
      force: true,
      forceReasonCode: 'paquete_no_ubicado',
      forceNote: 'no aparece en A3',
      userId: 'u-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok && !result.already_sealed) {
      expect(result.forced).toEqual({
        reason_code: 'paquete_no_ubicado',
        note: 'no aparece en A3',
        released_count: 1,
      });
    }

    const release = ops.find((o) => o.table === 'dispatches' && o.kind === 'update');
    expect(release?.payload?.removal_reason).toContain('paquete_no_ubicado');
    expect(release?.payload?.deleted_at).toBeTruthy();
    expect(release?.filters).toContainEqual(['id', ['d1']]);
    expect(release?.filters).toContainEqual(['operator_id', 'op-1']);

    const audit = ops.find((o) => o.table === 'audit_logs');
    expect(audit?.payload).toMatchObject({
      operator_id: 'op-1',
      user_id: 'u-1',
      action: 'force_seal_route',
      resource_type: 'routes',
      resource_id: 'route-1',
    });
    expect((audit?.payload?.changes_json as Record<string, unknown>)?.reason_code).toBe('paquete_no_ubicado');
    expect((audit?.payload?.changes_json as Record<string, unknown>)?.released_count).toBe(1);

    expect(rpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({ p_to_status: 'loaded' }));
  });

  /**
   * spec-77 phase 1b — corrects the phase-1 scope note above (this test used
   * to assert the OPPOSITE): a `partially_staged` stop no longer blocks the
   * force. It splits: the packages query below stands in for
   * `force-seal-split.ts`'s own lookup (unit-tested in
   * `force-seal-split.test.ts`), returning one genuinely-loaded package (a
   * real scan) and one that is not, so the split has something real to do.
   */
  it('force with a valid reason splits a partially_staged stop', async () => {
    const { client, rpc, ops } = buildClient({
      counts: { total_stops: 1, pending_stops: 0, partially_staged_stops: 1, staged_stops: 0, adopted_stops: 0 },
      pendingRows: [{ id: 'd1', order_id: 'o1', stage: 'partially_staged', orders: { order_number: 'ORD-1' } }],
      splitPackages: [
        { id: 'p1', order_id: 'o1', status: 'en_carga', loaded_at: '2026-09-05T10:00:00Z', load_inferred: false },
        { id: 'p2', order_id: 'o1', status: 'sectorizado', loaded_at: null, load_inferred: false },
      ],
    });

    const result = await sealRoute(client, {
      routeId: 'route-1',
      operatorId: 'op-1',
      force: true,
      forceReasonCode: 'turno_terminado',
      userId: 'u-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok && !result.already_sealed) {
      expect(result.forced).toEqual({
        reason_code: 'turno_terminado',
        released_count: 0,
        split_count: 1,
        split_order_ids: ['o1'],
      });
    }

    const dispatchUpdate = ops.find((o) => o.table === 'dispatches' && o.kind === 'update');
    expect(dispatchUpdate?.payload).toMatchObject({ stage: 'force_split' });
    expect(dispatchUpdate?.payload?.deleted_at).toBeUndefined();

    const audit = ops.find((o) => o.table === 'audit_logs');
    expect((audit?.payload?.changes_json as Record<string, unknown>)?.split_count).toBe(1);
    expect((audit?.payload?.changes_json as Record<string, unknown>)?.split_order_ids).toEqual(['o1']);

    expect(rpc).toHaveBeenCalledWith('transition_route_status', expect.objectContaining({ p_to_status: 'loaded' }));
  });

  /** A mixed force call — one untouched stop released, one mixed stop split
   * — leaves exactly one audit row, not two. */
  it('force with a valid reason handles a planned AND a partially_staged stop in one call', async () => {
    const { client, ops } = buildClient({
      counts: { total_stops: 3, pending_stops: 1, partially_staged_stops: 1, staged_stops: 1, adopted_stops: 0 },
      pendingRows: [
        { id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } },
        { id: 'd2', order_id: 'o2', stage: 'partially_staged', orders: { order_number: 'ORD-2' } },
      ],
      splitPackages: [
        { id: 'p1', order_id: 'o2', status: 'en_carga', loaded_at: '2026-09-05T10:00:00Z', load_inferred: false },
      ],
    });

    const result = await sealRoute(client, {
      routeId: 'route-1',
      operatorId: 'op-1',
      force: true,
      forceReasonCode: 'vehiculo_lleno',
      userId: 'u-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok && !result.already_sealed) {
      expect(result.forced).toEqual({
        reason_code: 'vehiculo_lleno',
        released_count: 1,
        split_count: 1,
        split_order_ids: ['o2'],
      });
    }

    expect(ops.filter((o) => o.table === 'audit_logs').length).toBe(1);
  });

  it('a failed release throws (surfaces as a 500 at the handler, per the shared catch)', async () => {
    const { client } = buildClient({
      counts: { total_stops: 1, pending_stops: 1, partially_staged_stops: 0, staged_stops: 0, adopted_stops: 0 },
      pendingRows: [{ id: 'd1', order_id: 'o1', stage: 'planned', orders: { order_number: 'ORD-1' } }],
      releaseError: { message: 'connection reset' },
    });

    await expect(
      sealRoute(client, {
        routeId: 'route-1',
        operatorId: 'op-1',
        force: true,
        forceReasonCode: 'paquete_no_ubicado',
      }),
    ).rejects.toBeTruthy();
  });
});
