import { describe, it, expect, vi, beforeEach } from 'vitest';
import { advancePackagesToEnCarga, stageDispatch } from './stage-dispatch';

/**
 * spec-74 phase 2 — direct unit coverage of the two writes this file makes,
 * isolated from the two HTTP handlers that call it
 * ([id]/scan/route.test.ts and load-positions/scan/route.test.ts already
 * cover the handler-level wiring). Same mock-chain style as
 * scan-validator.test.ts: record every table/filter/payload rather than
 * mock the client wholesale.
 *
 * spec-74 phase 3 review Fix 2/Fix 3 — `stageDispatch` no longer runs its
 * own recompute query + dispatch update as two app-layer statements. It
 * writes the package first (`advancePackagesToEnCarga`, Fix 2's ordering),
 * then calls the `recompute_dispatch_stage` RPC (Fix 3's atomic
 * lock-recompute-write, done inside the database). The mock below adds an
 * `rpc` spy alongside `from` so both halves of that sequence — and their
 * ORDER relative to each other — can be asserted.
 */

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][]; select?: string }
interface RpcCall { fn: string; args: Record<string, unknown> }

/**
 * `packagesResult` seeds what the `packages` table's `.update(...).select('id')`
 * chain resolves to (the write `advancePackagesToEnCarga` makes). Defaults to
 * a single matched row (the success case every pre-existing test assumed
 * implicitly).
 *
 * `rpcResult` seeds what `supabase.rpc('recompute_dispatch_stage', ...)`
 * resolves to — the DB function's own decision (adopted preserved,
 * partially_staged vs staged), now made inside 20260902000001's
 * `recompute_dispatch_stage`, not in this TS layer. Defaults to `staged`
 * (the common single-bulto case).
 *
 * `callOrder` records every op ('packages-write' | 'rpc') across BOTH mocks
 * in the sequence they actually happened, so Fix 2's ordering can be
 * asserted directly instead of inferred from which mocks were called.
 */
function buildClient(
  packagesResult: { data: unknown; error: { message: string } | null } = { data: [{ id: 'pkg-1' }], error: null },
  rpcResult: { data: unknown; error: { message: string } | null } = { data: 'staged', error: null },
) {
  const ops: Op[] = [];
  const rpcCalls: RpcCall[] = [];
  const callOrder: string[] = [];

  const from = vi.fn((table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.in = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.is = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.neq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.limit = vi.fn((n: number) => { op.filters.push(['limit', n]); return chain; });
    // spec-74 phase 2 review item 1 — records the widened idempotency guard.
    chain.or = vi.fn((expr: string) => { op.filters.push(['or', expr]); return chain; });
    chain.update = vi.fn((p: Record<string, unknown>) => { op.kind = 'update'; op.payload = p; return chain; });
    // spec-74 phase 2 review item 4 — `packages`' UPDATE now chains
    // `.select('id')` and resolves through IT, not through `.eq()`/`.in()`
    // directly, so `.select()` here is the thenable for that one case.
    chain.select = vi.fn((cols: string) => {
      op.select = cols;
      if (table === 'packages' && op.kind === 'update') {
        callOrder.push('packages-write');
        return Promise.resolve(packagesResult);
      }
      return chain;
    });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    };
    return chain;
  });

  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    callOrder.push('rpc');
    return Promise.resolve(rpcResult);
  });

  return { client: { from, rpc } as never, ops, rpcCalls, callOrder };
}

beforeEach(() => vi.clearAllMocks());

describe('advancePackagesToEnCarga', () => {
  /**
   * spec-74 phase 2. Used to sweep every package of the order (`.eq('order_id', ...)`)
   * — the exact multi-bulto over-claim spec-74 exists to kill (a scan of ONE
   * bulto silently advanced its siblings too). Scoped to the one package
   * actually scanned.
   */
  it('scopes the write to the one package scanned, not the whole order', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.kind).toBe('update');
    expect(pkgOp?.filters).toContainEqual(['id', 'pkg-1']);
    expect(pkgOp?.filters).not.toContainEqual(['order_id', 'pkg-1']);
    expect(pkgOp?.filters.some(([col]) => col === 'order_id')).toBe(false);
  });

  it('records the per-box load fact — loaded_at and loaded_by — alongside the status advance', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.payload?.status).toBe('en_carga');
    expect(pkgOp?.payload?.loaded_at).toBeTruthy();
    expect(pkgOp?.payload?.loaded_by).toBe('u-1');
  });

  /**
   * spec-79 BLOCKER: the route linkage `packages` never carried before —
   * without this, isGenuinelyLoadedPackage (dispatch-load-state.ts) cannot
   * tell "loaded onto THIS route" from "loaded onto some other route" and a
   * force-split order's second half reappears on the wrong route's manifest.
   */
  it('records loaded_route_id alongside the rest of the per-box load fact', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.payload?.loaded_route_id).toBe('route-1');
  });

  /**
   * spec-74 phase 2 review item 1 — this used to be an invariant
   * ("load_inferred is never set here"). It is now explicitly cleared to
   * `false` on every genuine scan: a package can arrive at this write
   * already `load_inferred = true` (phase 1's backfill), and a real scan
   * is exactly the event that stops it being an assumption.
   */
  it('clears load_inferred to false on the write (a real scan is not an inference)', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.payload?.load_inferred).toBe(false);
  });

  /**
   * spec-74 phase 2 review item 1 — the write guard used to be
   * `.is('loaded_at', null)` alone, which would now permanently no-op on a
   * genuinely inferred (backfilled) row: such a row already has `loaded_at`
   * set, so a real scan of it would silently fail to write. Widened to an
   * OR: an untouched row OR an inferred one may still be written by a real
   * scan.
   */
  it('guards the write with loaded_at IS NULL OR load_inferred = true', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.filters).toContainEqual(['or', 'loaded_at.is.null,load_inferred.eq.true']);
    // The old, narrower guard must be gone, not merely joined by the new one.
    expect(pkgOp?.filters).not.toContainEqual(['loaded_at', null]);
  });

  it('scopes to the operator and only the dispatchable statuses', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.filters).toContainEqual(['operator_id', 'op-1']);
    expect(pkgOp?.filters.some(([col]) => col === 'status')).toBe(true);
  });

  /**
   * spec-74 phase 2 review item 4 — the write used to be awaited and
   * discarded. A failing query is not "nothing to report": it must not be
   * swallowed while the caller's dispatch update has already committed.
   */
  it('throws when the packages update itself fails', async () => {
    const { client } = buildClient({ data: null, error: { message: 'connection terminated unexpectedly' } });
    await expect(
      advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' }),
    ).rejects.toThrow(/connection terminated/);
  });

  /**
   * spec-74 phase 2 review item 4 — the write can legitimately match zero
   * rows (operator/package mismatch, a status outside DISPATCHABLE_STATUSES,
   * a lost race) while nothing about that is surfaced today: the caller's
   * dispatch update already committed and the handler returns 201 anyway.
   * A zero-row match must now be treated as a failure too.
   */
  it('throws when the packages update matches zero rows', async () => {
    const { client } = buildClient({ data: [], error: null });
    await expect(
      advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1', routeId: 'route-1' }),
    ).rejects.toThrow(/no package row matched/);
  });
});

describe('stageDispatch', () => {
  it('advances only the scanned package and returns the RPC-decided stage', async () => {
    const { client, ops, rpcCalls } = buildClient(undefined, { data: 'staged', error: null });
    const result = await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'planned',
      routeId: 'route-1',
    });

    expect(result).toBe('staged');
    const pkgOp = ops.find((o) => o.table === 'packages' && o.kind === 'update');
    expect(pkgOp?.filters).toContainEqual(['id', 'pkg-1']);
    expect(pkgOp?.filters.some(([col]) => col === 'order_id')).toBe(false);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('recompute_dispatch_stage');
  });

  /**
   * spec-74 phase 3 review Fix 2 (BLOCKER). This used to write the dispatch
   * row FIRST, then advance the package — a failure on the package write
   * left the dispatch AHEAD of reality (`staged` with `loaded_at IS NULL`),
   * which opens the seal on a box never actually loaded. The fix is
   * ordering: the package write must happen, and succeed, BEFORE the
   * dispatch is ever touched. Asserted directly via `callOrder` rather than
   * inferred from which mocks fired.
   */
  it('writes the package before calling recompute_dispatch_stage (fail-safe ordering)', async () => {
    const { client, callOrder } = buildClient();
    await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'planned',
      routeId: 'route-1',
    });

    expect(callOrder).toEqual(['packages-write', 'rpc']);
  });

  /**
   * spec-74 phase 3 review Fix 2. The other half of the ordering fix: if the
   * package write fails, the RPC must never be called at all — a dispatch
   * left un-recomputed (still `planned`/`partially_staged`) is fail-safe
   * (refuses the seal), unlike the old ordering which would have already
   * committed a `staged` dispatch by this point.
   */
  it('never calls recompute_dispatch_stage when the packages advance fails', async () => {
    const { client, rpcCalls } = buildClient({ data: [], error: null });
    await expect(
      stageDispatch(client, {
        dispatchId: 'd1',
        orderId: 'o1',
        packageId: 'pkg-1',
        operatorId: 'op-1',
        userId: 'u-1',
        currentStage: 'planned',
        routeId: 'route-1',
      }),
    ).rejects.toThrow(/no package row matched/);

    expect(rpcCalls).toHaveLength(0);
  });

  /**
   * spec-74 phase 3 review Fix 3 (BLOCKER). The read-then-write recompute
   * that used to live in this file (two app-layer statements, racy under
   * concurrent scans of one order) is now `recompute_dispatch_stage`
   * (20260902000001) — a single atomic DB statement under a row lock.
   * `stageDispatch` itself no longer decides partially_staged vs staged vs
   * adopted; it passes the four identifiers the RPC needs and trusts its
   * answer. Coverage for the actual recompute logic (adopted preserved,
   * DISPATCHABLE_STATUSES-intersected outstanding count, the lock/race
   * behaviour) lives in pgTAP now — see
   * spec74_phase3_partially_staged.test.sql — not here.
   */
  it('calls recompute_dispatch_stage with the dispatch, operator, order, and user ids', async () => {
    const { client, rpcCalls } = buildClient();
    await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'planned',
      routeId: 'route-1',
    });

    expect(rpcCalls[0].args).toEqual({
      p_dispatch_id: 'd1',
      p_operator_id: 'op-1',
      p_order_id: 'o1',
      p_user_id: 'u-1',
    });
  });

  it('returns whatever stage the RPC reports, including adopted', async () => {
    const { client } = buildClient(undefined, { data: 'adopted', error: null });
    const result = await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'adopted',
      routeId: 'route-1',
    });

    expect(result).toBe('adopted');
  });

  it('returns partially_staged when the RPC reports it', async () => {
    const { client } = buildClient(undefined, { data: 'partially_staged', error: null });
    const result = await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'planned',
      routeId: 'route-1',
    });

    expect(result).toBe('partially_staged');
  });

  it('propagates a failure from recompute_dispatch_stage itself', async () => {
    const { client } = buildClient(undefined, { data: null, error: { message: 'connection terminated unexpectedly' } });
    await expect(
      stageDispatch(client, {
        dispatchId: 'd1',
        orderId: 'o1',
        packageId: 'pkg-1',
        operatorId: 'op-1',
        userId: 'u-1',
        currentStage: 'planned',
        routeId: 'route-1',
      }),
    ).rejects.toThrow(/connection terminated/);
  });

  it('throws when recompute_dispatch_stage returns no stage', async () => {
    const { client } = buildClient(undefined, { data: null, error: null });
    await expect(
      stageDispatch(client, {
        dispatchId: 'd1',
        orderId: 'o1',
        packageId: 'pkg-1',
        operatorId: 'op-1',
        userId: 'u-1',
        currentStage: 'planned',
        routeId: 'route-1',
      }),
    ).rejects.toThrow(/returned no stage/);
  });

  /**
   * spec-74 phase 2 review item 4 — stageDispatch composes the packages
   * advance with the recompute; a failure in the former must propagate, not
   * be swallowed.
   */
  it('propagates a failure from the packages advance', async () => {
    const { client } = buildClient({ data: [], error: null });
    await expect(
      stageDispatch(client, {
        dispatchId: 'd1',
        orderId: 'o1',
        packageId: 'pkg-1',
        operatorId: 'op-1',
        userId: 'u-1',
        currentStage: 'planned',
        routeId: 'route-1',
      }),
    ).rejects.toThrow(/no package row matched/);
  });
});
