import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouteBlocks } from './useRouteBlocks';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

function chainResolving(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data, error }),
  };
}

function mockTables(opts: {
  blocks: unknown;
  blocksError?: unknown;
  dispatches: unknown;
  dispatchesError?: unknown;
  packages?: unknown;
  packagesError?: unknown;
}) {
  const blocksChain = chainResolving(opts.blocks, opts.blocksError ?? null);
  const dispatchesChain = chainResolving(opts.dispatches, opts.dispatchesError ?? null);
  const packagesChain = chainResolving(opts.packages ?? [], opts.packagesError ?? null);
  mockFrom.mockImplementation((table: string) => {
    if (table === 'route_blocks') return blocksChain;
    if (table === 'packages') return packagesChain;
    return dispatchesChain;
  });
  return { blocksChain, dispatchesChain, packagesChain };
}

describe('useRouteBlocks', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId is null', () => {
    const { result } = renderHook(() => useRouteBlocks(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useRouteBlocks('route-1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns blocks in sequence_index order with comuna name and order/package counts', async () => {
    mockTables({
      blocks: [
        { id: 'block-2', comuna_id: 'comuna-2', sequence_index: 2, sequence_source: 'default', chile_comunas: { nombre: 'Dos' } },
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        { id: 'd-2', order_id: 'order-2', orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-1' } },
        { id: 'd-3', order_id: 'order-3', orders: { id: 'order-3', order_number: 'ORD-3', comuna_id: 'comuna-2' } },
      ],
      packages: [
        { order_id: 'order-1' },
        { order_id: 'order-1' },
        { order_id: 'order-2' },
        { order_id: 'order-3' },
      ],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Sorted by sequence_index, not insertion order of the mocked rows.
    expect(result.current.data?.blocks.map((b) => b.id)).toEqual(['block-1', 'block-2']);
    expect(result.current.data?.blocks[0]).toMatchObject({
      comunaId: 'comuna-1',
      comunaName: 'Uno',
      sequenceIndex: 1,
      sequenceSource: 'default',
      orderCount: 2,
      packageCount: 3,
    });
    expect(result.current.data?.blocks[1]).toMatchObject({
      comunaId: 'comuna-2',
      comunaName: 'Dos',
      orderCount: 1,
      packageCount: 1,
    });
    expect(result.current.data?.unblocked).toEqual([]);
  });

  /**
   * spec-72 phase 3 MANDATORY requirement: an order whose comuna_id is
   * non-NULL but has no live route_blocks row for that comuna on this
   * route must be surfaced as an orphan, not silently dropped. This is the
   * scan-adopt gap phase 2's migration documents.
   */
  it('surfaces an orphan order — non-NULL comuna_id, no matching live block', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        // Adopted onto an already-seeded route — comuna-2 has no block.
        { id: 'd-2', order_id: 'order-2', orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.unblocked).toHaveLength(1);
    expect(result.current.data?.unblocked[0]).toMatchObject({
      orderId: 'order-2',
      orderNumber: 'ORD-2',
      reason: 'orphan',
    });
  });

  /**
   * spec-72 phase 3: an empty-draft route (createEmptyDraft never calls
   * create_seeded_route) has zero blocks at all — every one of its orders
   * (gained only via scan-adopt) must still surface, as orphans, rather
   * than the block list rendering as if the route has no orders.
   */
  it('surfaces every order as an orphan when the route has zero blocks at all', async () => {
    mockTables({
      blocks: [],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        { id: 'd-2', order_id: 'order-2', orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.blocks).toEqual([]);
    expect(result.current.data?.unblocked).toHaveLength(2);
    expect(result.current.data?.unblocked.every((u) => u.reason === 'orphan')).toBe(true);
  });

  it('surfaces a NULL-comuna order as "sin comuna", not an orphan', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        { id: 'd-2', order_id: 'order-2', orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: null } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.unblocked).toHaveLength(1);
    expect(result.current.data?.unblocked[0]).toMatchObject({
      orderId: 'order-2',
      orderNumber: 'ORD-2',
      comunaName: null,
      reason: 'noComuna',
    });
  });

  it('returns empty blocks and unblocked when the route has no dispatches at all', async () => {
    mockTables({ blocks: [], dispatches: [] });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ blocks: [], unblocked: [] });
  });

  it('exposes isError when the blocks query fails', async () => {
    mockTables({ blocks: null, blocksError: new Error('DB error'), dispatches: [] });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('exposes isError when the dispatches query fails', async () => {
    mockTables({ blocks: [], dispatches: null, dispatchesError: new Error('DB error') });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('propagates an error from the packages query instead of silently returning zero counts', async () => {
    mockTables({
      blocks: [{ id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } }],
      dispatches: [{ id: 'd-1', order_id: 'order-1', orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } }],
      packages: null,
      packagesError: new Error('packages query failed'),
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  /**
   * spec-72 phase 5: a block's actualRank rolls up its member dispatches'
   * EARLIEST actual_sequence, ranked among only the blocks that have data.
   * Block 2 (comuna-2) arrives first (actual_sequence 1) despite being
   * planned second (sequence_index 2) — proves the mismatch surfaces.
   */
  it('computes actualRank from the earliest actual_sequence per block and flags a mismatch as outOfSequence', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
        { id: 'block-2', comuna_id: 'comuna-2', sequence_index: 2, sequence_source: 'default', chile_comunas: { nombre: 'Dos' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', actual_sequence: 3, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        { id: 'd-2', order_id: 'order-2', actual_sequence: 1, orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
        { id: 'd-3', order_id: 'order-3', actual_sequence: 2, orders: { id: 'order-3', order_number: 'ORD-3', comuna_id: 'comuna-2' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const block1 = result.current.data?.blocks.find((b) => b.id === 'block-1');
    const block2 = result.current.data?.blocks.find((b) => b.id === 'block-2');

    // block-2's earliest actual_sequence is 1 (min of 1,2) -> ranked 1st
    // overall -> actual rank 1, but planned rank is 2nd in the list -> mismatch.
    expect(block2).toMatchObject({ actualRank: 1, outOfSequence: true });
    // block-1's only dispatch has actual_sequence 3 -> ranked 2nd (the only
    // other ranked block) -> actual rank 2, planned rank 1 -> mismatch too.
    expect(block1).toMatchObject({ actualRank: 2, outOfSequence: true });
  });

  it('leaves actualRank null and outOfSequence false when no dispatch in a block has arrived yet', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', actual_sequence: null, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.blocks[0]).toMatchObject({ actualRank: null, outOfSequence: false });
  });

  it('reports actualRank matching plannedRank as in-sequence, not a mismatch', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
        { id: 'block-2', comuna_id: 'comuna-2', sequence_index: 2, sequence_source: 'default', chile_comunas: { nombre: 'Dos' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', actual_sequence: 1, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        { id: 'd-2', order_id: 'order-2', actual_sequence: 2, orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.blocks[0]).toMatchObject({ actualRank: 1, outOfSequence: false });
    expect(result.current.data?.blocks[1]).toMatchObject({ actualRank: 2, outOfSequence: false });
  });

  /**
   * spec-72 phase 5 MANDATORY orphan exclusion: an orphan dispatch (comuna_id
   * set, no live block covering it) must never be pulled into ANY block's
   * actual-rank rollup, even when its actual_sequence would otherwise be the
   * earliest of all. The one real block's own dispatch stays correctly
   * ranked 1st (the only ranked block), never displaced by the orphan.
   */
  it('excludes an orphan dispatch actual_sequence from every block rollup', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', actual_sequence: 2, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        // Orphan: comuna-2 has no live block, arrived FIRST (actual_sequence 1).
        { id: 'd-2', order_id: 'order-2', actual_sequence: 1, orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Only one live block exists, so its actual rank is 1st regardless of
    // the orphan's earlier timestamp — the orphan is invisible to ranking.
    expect(result.current.data?.blocks[0]).toMatchObject({ actualRank: 1, outOfSequence: false });
    expect(result.current.data?.unblocked).toHaveLength(1);
    expect(result.current.data?.unblocked[0]).toMatchObject({ orderId: 'order-2', reason: 'orphan' });
  });

  /**
   * REVIEW FINDING (phase 5) — partial arrival data must not fabricate a
   * mismatch. `actualRank` is a rank among ONLY the blocks that have data,
   * so the planned side of the comparison has to be the SAME population.
   * Comparing it against a position in the FULL block list flags every block
   * after an un-arrived one as out of sequence even when the driver visited
   * them in exactly the planned order.
   *
   * Here block-1 (planned first) has no arrival at all — a failed/skipped
   * stop, which a completed route can legitimately contain. block-2 and
   * block-3 were then visited in planned order. Neither is out of sequence.
   * Sequence indices are deliberately non-contiguous (1, 2, 4) to prove the
   * planned side is a POSITION, not the raw sequence_index.
   */
  it('does not flag later blocks as out of sequence when an earlier block has no arrival data', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
        { id: 'block-2', comuna_id: 'comuna-2', sequence_index: 2, sequence_source: 'default', chile_comunas: { nombre: 'Dos' } },
        { id: 'block-3', comuna_id: 'comuna-3', sequence_index: 4, sequence_source: 'default', chile_comunas: { nombre: 'Tres' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', actual_sequence: null, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        { id: 'd-2', order_id: 'order-2', actual_sequence: 1, orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
        { id: 'd-3', order_id: 'order-3', actual_sequence: 2, orders: { id: 'order-3', order_number: 'ORD-3', comuna_id: 'comuna-3' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [b1, b2, b3] = result.current.data!.blocks;
    expect(b1).toMatchObject({ actualRank: null, outOfSequence: false });
    expect(b2).toMatchObject({ actualRank: 1, outOfSequence: false });
    expect(b3).toMatchObject({ actualRank: 2, outOfSequence: false });
  });

  /**
   * REVIEW FINDING (phase 5) — the companion of the test above: with the same
   * un-arrived first block, a genuine swap of the two blocks that DID arrive
   * must still be flagged. This is what stops the fix from degenerating into
   * "never flag anything once a block is missing data".
   */
  it('still flags a real swap among the blocks that do have arrival data', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
        { id: 'block-2', comuna_id: 'comuna-2', sequence_index: 2, sequence_source: 'default', chile_comunas: { nombre: 'Dos' } },
        { id: 'block-3', comuna_id: 'comuna-3', sequence_index: 4, sequence_source: 'default', chile_comunas: { nombre: 'Tres' } },
      ],
      dispatches: [
        { id: 'd-1', order_id: 'order-1', actual_sequence: null, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
        // block-3 (planned last) arrived BEFORE block-2 — a real inversion.
        { id: 'd-2', order_id: 'order-2', actual_sequence: 2, orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
        { id: 'd-3', order_id: 'order-3', actual_sequence: 1, orders: { id: 'order-3', order_number: 'ORD-3', comuna_id: 'comuna-3' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [b1, b2, b3] = result.current.data!.blocks;
    expect(b1).toMatchObject({ actualRank: null, outOfSequence: false });
    expect(b2).toMatchObject({ actualRank: 2, outOfSequence: true });
    expect(b3).toMatchObject({ actualRank: 1, outOfSequence: true });
  });

  /**
   * REVIEW FINDING (phase 5) — the actual-rank sort had no tiebreak at all
   * (`a[1] - b[1] || 0`), despite a comment claiming it fell back to
   * sequence_index. `actual_sequence` is a plain integer column, so a manual
   * correction or backfill can duplicate a value across two blocks; without a
   * tiebreak the resulting order is whatever the (unordered) dispatch query
   * happened to return. Here the tied blocks are supplied in REVERSE planned
   * order to prove the tiebreak, not the arrival order of the rows, decides.
   */
  it('breaks an actual_sequence tie by planned order, deterministically', async () => {
    mockTables({
      blocks: [
        { id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } },
        { id: 'block-2', comuna_id: 'comuna-2', sequence_index: 2, sequence_source: 'default', chile_comunas: { nombre: 'Dos' } },
      ],
      dispatches: [
        { id: 'd-2', order_id: 'order-2', actual_sequence: 5, orders: { id: 'order-2', order_number: 'ORD-2', comuna_id: 'comuna-2' } },
        { id: 'd-1', order_id: 'order-1', actual_sequence: 5, orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } },
      ],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [b1, b2] = result.current.data!.blocks;
    expect(b1).toMatchObject({ actualRank: 1, outOfSequence: false });
    expect(b2).toMatchObject({ actualRank: 2, outOfSequence: false });
  });

  it('operator_id and deleted_at scoping is applied on every query', async () => {
    const { blocksChain, dispatchesChain } = mockTables({
      blocks: [{ id: 'block-1', comuna_id: 'comuna-1', sequence_index: 1, sequence_source: 'default', chile_comunas: { nombre: 'Uno' } }],
      dispatches: [{ id: 'd-1', order_id: 'order-1', orders: { id: 'order-1', order_number: 'ORD-1', comuna_id: 'comuna-1' } }],
      packages: [],
    });

    const { result } = renderHook(() => useRouteBlocks('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(blocksChain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(blocksChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(dispatchesChain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(dispatchesChain.is).toHaveBeenCalledWith('deleted_at', null);
  });
});
