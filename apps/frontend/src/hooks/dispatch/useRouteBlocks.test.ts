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
