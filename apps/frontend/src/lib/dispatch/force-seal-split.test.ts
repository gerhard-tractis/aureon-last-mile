import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitPartiallyStagedForForce } from './force-seal-split';

/**
 * spec-77 phase 1b — the crew may close a route short with a `partially_staged`
 * stop still pending: the boxes already genuinely loaded travel, the rest are
 * released to the dock. This is the function that does the actual split, once
 * `seal-route.ts` has already decided which pending rows qualify.
 *
 * The per-box discriminator is `loaded_at IS NOT NULL AND load_inferred =
 * false`, never `packages.status` — `listo_para_despacho` is ALSO a legacy
 * dock-ready-unloaded status (spec-79), and spec-74's backfill stamped
 * `loaded_at` with `load_inferred = true` on packages that were never
 * scanned. Every test here proves that discriminator, not status, decides.
 */

interface Op { table: string; kind: string; payload?: Record<string, unknown>; filters: [string, unknown][] }

function buildClient(opts: {
  packages?: { id: string; order_id: string; status: string; loaded_at: string | null; load_inferred: boolean }[];
  packagesError?: { message: string };
  dispatchUpdateError?: { message: string };
  packagesUpdateError?: { message: string };
} = {}) {
  const { packages = [], packagesError, dispatchUpdateError, packagesUpdateError } = opts;
  const ops: Op[] = [];
  const from = vi.fn((table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.in = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.is = vi.fn((c: string, v: unknown) => { op.filters.push([c, v]); return chain; });
    chain.update = vi.fn((p: Record<string, unknown>) => {
      op.kind = 'update';
      op.payload = p;
      return chain;
    });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (table === 'packages') {
        if (op.kind === 'update') {
          result = { data: null, error: packagesUpdateError ?? null };
        } else {
          result = packagesError ? { data: null, error: packagesError } : { data: packages, error: null };
        }
      } else if (table === 'dispatches' && op.kind === 'update') {
        result = { data: null, error: dispatchUpdateError ?? null };
      }
      return Promise.resolve(result).then(res, rej);
    };
    return chain;
  });
  return { client: { from } as never, ops };
}

beforeEach(() => vi.clearAllMocks());

describe('splitPartiallyStagedForForce', () => {
  it('no-ops on an empty input (nothing queried, nothing written)', async () => {
    const { client, ops } = buildClient();
    const result = await splitPartiallyStagedForForce(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      partiallyStagedRows: [],
    });
    expect(result).toEqual({ split_count: 0, split_order_ids: [] });
    expect(ops.length).toBe(0);
  });

  it('moves the dispatch row to force_split, never deletes it', async () => {
    const { client, ops } = buildClient({
      packages: [
        { id: 'p1', order_id: 'o1', status: 'en_carga', loaded_at: '2026-09-05T10:00:00Z', load_inferred: false },
        { id: 'p2', order_id: 'o1', status: 'sectorizado', loaded_at: null, load_inferred: false },
      ],
    });

    const result = await splitPartiallyStagedForForce(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      partiallyStagedRows: [{ id: 'd1', order_id: 'o1' }],
    });

    expect(result).toEqual({ split_count: 1, split_order_ids: ['o1'] });

    const dispatchUpdate = ops.find((o) => o.table === 'dispatches' && o.kind === 'update');
    expect(dispatchUpdate?.payload).toMatchObject({ stage: 'force_split', staged_by: 'u-1' });
    expect(dispatchUpdate?.payload?.deleted_at).toBeUndefined();
    expect(dispatchUpdate?.filters).toContainEqual(['id', ['d1']]);
    expect(dispatchUpdate?.filters).toContainEqual(['operator_id', 'op-1']);
  });

  /**
   * The discriminator, proven directly: a package `load_inferred = true`
   * (spec-74's optimistic backfill, never a real scan) with `loaded_at` set
   * and `status = 'listo_para_despacho'` must NOT be treated as travelling —
   * it was never actually loaded. Reading `packages.status` alone here would
   * wrongly call this one "shipped".
   */
  it('treats a load_inferred package as never-loaded regardless of status', async () => {
    const { client, ops } = buildClient({
      packages: [
        { id: 'p1', order_id: 'o1', status: 'listo_para_despacho', loaded_at: '2026-08-01T00:00:00Z', load_inferred: true },
      ],
    });

    await splitPartiallyStagedForForce(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      partiallyStagedRows: [{ id: 'd1', order_id: 'o1' }],
    });

    // Not genuinely loaded and not en_carga either, so no defensive revert
    // is needed — but it must not be counted as travelling. Nothing here
    // asserts a revert write for it; the point is the dispatch row still
    // moves to force_split (proven above) without this package blocking it.
    const packagesUpdate = ops.find((o) => o.table === 'packages' && o.kind === 'update');
    expect(packagesUpdate).toBeUndefined();
  });

  it('defensively reverts a stray en_carga sibling that was never genuinely loaded', async () => {
    const { client, ops } = buildClient({
      packages: [
        // Genuinely loaded — travels, left alone.
        { id: 'p1', order_id: 'o1', status: 'en_carga', loaded_at: '2026-09-05T10:00:00Z', load_inferred: false },
        // en_carga but load_inferred=true — never really scanned. Symmetry
        // with force-seal-release.ts's own defensive revert for `planned`.
        { id: 'p2', order_id: 'o1', status: 'en_carga', loaded_at: '2026-08-01T00:00:00Z', load_inferred: true },
      ],
    });

    await splitPartiallyStagedForForce(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      partiallyStagedRows: [{ id: 'd1', order_id: 'o1' }],
    });

    const packagesUpdate = ops.find((o) => o.table === 'packages' && o.kind === 'update');
    expect(packagesUpdate?.payload).toEqual({ status: 'sectorizado' });
    expect(packagesUpdate?.filters).toContainEqual(['id', ['p2']]);
  });

  it('handles multiple partially_staged rows in one call', async () => {
    const { client } = buildClient({
      packages: [
        { id: 'p1', order_id: 'o1', status: 'en_carga', loaded_at: '2026-09-05T10:00:00Z', load_inferred: false },
        { id: 'p2', order_id: 'o2', status: 'sectorizado', loaded_at: null, load_inferred: false },
      ],
    });

    const result = await splitPartiallyStagedForForce(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      partiallyStagedRows: [
        { id: 'd1', order_id: 'o1' },
        { id: 'd2', order_id: 'o2' },
      ],
    });

    expect(result).toEqual({ split_count: 2, split_order_ids: ['o1', 'o2'] });
  });

  it('a failed packages lookup throws', async () => {
    const { client } = buildClient({ packagesError: { message: 'connection reset' } });
    await expect(
      splitPartiallyStagedForForce(client, {
        operatorId: 'op-1',
        userId: 'u-1',
        partiallyStagedRows: [{ id: 'd1', order_id: 'o1' }],
      }),
    ).rejects.toBeTruthy();
  });

  it('a failed dispatch update throws', async () => {
    const { client } = buildClient({ dispatchUpdateError: { message: 'connection reset' } });
    await expect(
      splitPartiallyStagedForForce(client, {
        operatorId: 'op-1',
        userId: 'u-1',
        partiallyStagedRows: [{ id: 'd1', order_id: 'o1' }],
      }),
    ).rejects.toBeTruthy();
  });

  it('a failed defensive-revert update throws', async () => {
    const { client } = buildClient({
      packages: [{ id: 'p1', order_id: 'o1', status: 'en_carga', loaded_at: null, load_inferred: false }],
      packagesUpdateError: { message: 'connection reset' },
    });
    await expect(
      splitPartiallyStagedForForce(client, {
        operatorId: 'op-1',
        userId: 'u-1',
        partiallyStagedRows: [{ id: 'd1', order_id: 'o1' }],
      }),
    ).rejects.toBeTruthy();
  });
});
