import { describe, it, expect, vi, beforeEach } from 'vitest';
import { advancePackagesToEnCarga, stageDispatch } from './stage-dispatch';

/**
 * spec-74 phase 2 — direct unit coverage of the two writes this file makes,
 * isolated from the two HTTP handlers that call it
 * ([id]/scan/route.test.ts and load-positions/scan/route.test.ts already
 * cover the handler-level wiring). Same mock-chain style as
 * scan-validator.test.ts: record every table/filter/payload rather than
 * mock the client wholesale.
 */

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][]; select?: string }

/**
 * `packagesResult` seeds what the `packages` table's `.select('id')` chain
 * resolves to — the return `advancePackagesToEnCarga` now inspects for the
 * review item 4 error/zero-rows check. Defaults to a single matched row (the
 * success case every pre-existing test assumed implicitly).
 */
function buildClient(packagesResult: { data: unknown; error: { message: string } | null } = { data: [{ id: 'pkg-1' }], error: null }) {
  const ops: Op[] = [];
  const from = vi.fn((table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.in = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.is = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    // spec-74 phase 2 review item 1 — records the widened idempotency guard.
    chain.or = vi.fn((expr: string) => { op.filters.push(['or', expr]); return chain; });
    chain.update = vi.fn((p: Record<string, unknown>) => { op.kind = 'update'; op.payload = p; return chain; });
    // spec-74 phase 2 review item 4 — `packages`' update now chains
    // `.select('id')` and resolves through IT, not through `.eq()`/`.in()`
    // directly, so `.select()` here is the thenable, not a passthrough.
    chain.select = vi.fn((cols: string) => {
      op.select = cols;
      return table === 'packages'
        ? Promise.resolve(packagesResult)
        : Promise.resolve({ data: null, error: null });
    });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej);
    return chain;
  });
  return { client: { from } as never, ops };
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
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.kind).toBe('update');
    expect(pkgOp?.filters).toContainEqual(['id', 'pkg-1']);
    expect(pkgOp?.filters).not.toContainEqual(['order_id', 'pkg-1']);
    expect(pkgOp?.filters.some(([col]) => col === 'order_id')).toBe(false);
  });

  it('records the per-box load fact — loaded_at and loaded_by — alongside the status advance', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.payload?.status).toBe('en_carga');
    expect(pkgOp?.payload?.loaded_at).toBeTruthy();
    expect(pkgOp?.payload?.loaded_by).toBe('u-1');
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
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' });

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
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' });

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.filters).toContainEqual(['or', 'loaded_at.is.null,load_inferred.eq.true']);
    // The old, narrower guard must be gone, not merely joined by the new one.
    expect(pkgOp?.filters).not.toContainEqual(['loaded_at', null]);
  });

  it('scopes to the operator and only the dispatchable statuses', async () => {
    const { client, ops } = buildClient();
    await advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' });

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
      advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' }),
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
      advancePackagesToEnCarga(client, { operatorId: 'op-1', packageId: 'pkg-1', userId: 'u-1' }),
    ).rejects.toThrow(/no package row matched/);
  });
});

describe('stageDispatch', () => {
  it('stages the dispatch row and advances only the scanned package', async () => {
    const { client, ops } = buildClient();
    await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'planned',
    });

    const dispatchOp = ops.find((o) => o.table === 'dispatches');
    expect(dispatchOp?.payload?.stage).toBe('staged');
    expect(dispatchOp?.filters).toContainEqual(['id', 'd1']);

    const pkgOp = ops.find((o) => o.table === 'packages');
    expect(pkgOp?.filters).toContainEqual(['id', 'pkg-1']);
    expect(pkgOp?.filters.some(([col]) => col === 'order_id')).toBe(false);
  });

  /**
   * spec-74 phase 2 review item 3 — the HIGH-adjacent finding: this used to
   * write `stage: 'staged'` unconditionally, which silently rewrote an
   * `adopted` dispatch (never planned onto this route at all) the moment a
   * sibling bulto was scanned. Only a `planned` row may become `staged`;
   * `adopted` must survive unchanged.
   */
  it('preserves adopted instead of overwriting it to staged', async () => {
    const { client, ops } = buildClient();
    await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'adopted',
    });

    const dispatchOp = ops.find((o) => o.table === 'dispatches');
    expect(dispatchOp?.payload?.stage).toBe('adopted');
  });

  it('still writes staged for a planned row (the common case)', async () => {
    const { client, ops } = buildClient();
    await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-1',
      currentStage: 'planned',
    });

    const dispatchOp = ops.find((o) => o.table === 'dispatches');
    expect(dispatchOp?.payload?.stage).toBe('staged');
  });

  /**
   * spec-74 phase 2 review item 8 — `staged_at`/`staged_by` are written on
   * every accepted bulto (last-write-wins, documented as intentional in
   * stage-dispatch.ts). Pinned here so a future change notices if it starts
   * silently guarding this column instead.
   */
  it('overwrites staged_at/staged_by on every call — last write wins by design', async () => {
    const { client, ops } = buildClient();
    await stageDispatch(client, {
      dispatchId: 'd1',
      orderId: 'o1',
      packageId: 'pkg-1',
      operatorId: 'op-1',
      userId: 'u-2',
      currentStage: 'planned',
    });

    const dispatchOp = ops.find((o) => o.table === 'dispatches');
    expect(dispatchOp?.payload?.staged_by).toBe('u-2');
    expect(dispatchOp?.payload?.staged_at).toBeTruthy();
  });

  /**
   * spec-74 phase 2 review item 4 — stageDispatch composes the dispatch
   * update with advancePackagesToEnCarga; a failure in the latter must
   * propagate, not be swallowed after the dispatch row already committed.
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
      }),
    ).rejects.toThrow(/no package row matched/);
  });
});
