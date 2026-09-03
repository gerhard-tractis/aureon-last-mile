import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLoadingMonitor } from './useLoadingMonitor';

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

/** A chainable query-builder stub: every call returns itself except the
 *  last one in the real chain, which the test wires to resolve. */
function chainReturning(finalMethod: string, result: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in', 'gte', 'is', 'order'];
  for (const m of methods) {
    chain[m] = m === finalMethod ? vi.fn().mockResolvedValue(result) : vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('useLoadingMonitor', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useLoadingMonitor(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns empty data and skips dispatches/packages/users queries when there are no open routes', async () => {
    mockFrom.mockReturnValueOnce(chainReturning('order', { data: [], error: null }));
    const { result } = renderHook(() => useLoadingMonitor('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ routes: [], crew: [], packagesWaitingOnDock: 0 });
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('routes');
  });

  it('scopes every table read to operator_id, and bounds the routes read to route_date (I3)', async () => {
    const routesChain = chainReturning('order', {
      data: [
        {
          id: 'r1', external_route_id: 'DT-1', route_date: '2026-09-03',
          status: 'loading', load_position_id: 'pos-1', load_position_released_at: null,
          load_positions: { code: 'POS-04', label: 'A3' },
        },
      ],
      error: null,
    });
    const dispatchesChain = chainReturning('is', { data: [{ id: 'd1', route_id: 'r1', order_id: 'o1' }], error: null });
    const packagesChain = chainReturning('is', {
      data: [{ order_id: 'o1', loaded_at: '2026-09-03T11:00:00Z', loaded_by: 'u1', status: 'en_carga' }],
      error: null,
    });
    const usersChain = chainReturning('is', { data: [{ id: 'u1', full_name: 'Ana Soto' }], error: null });

    mockFrom
      .mockReturnValueOnce(routesChain)
      .mockReturnValueOnce(dispatchesChain)
      .mockReturnValueOnce(packagesChain)
      .mockReturnValueOnce(usersChain);

    const { result } = renderHook(() => useLoadingMonitor('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenNthCalledWith(1, 'routes');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'dispatches');
    expect(mockFrom).toHaveBeenNthCalledWith(3, 'packages');
    expect(mockFrom).toHaveBeenNthCalledWith(4, 'users');
    for (const chain of [routesChain, dispatchesChain, packagesChain, usersChain]) {
      expect((chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('operator_id', 'op-1');
    }
    // A real date string was passed, not undefined/omitted — the exact
    // value depends on "today" so this only asserts shape, not the number.
    expect((routesChain.gte as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'route_date', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('does NOT select or join fleet_vehicles — routes.vehicle_id/driver_name are only written by /dispatch, after this cohort (M3/D2)', async () => {
    const routesChain = chainReturning('order', { data: [], error: null });
    mockFrom.mockReturnValueOnce(routesChain);
    const { result } = renderHook(() => useLoadingMonitor('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const selectArg = (routesChain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).not.toContain('fleet_vehicles');
    expect(selectArg).not.toContain('driver_name');
  });

  it('maps a route with its occupied andén and package aggregates (no vehicle/driver, no updatedAtIso — C1/M3)', async () => {
    const routesChain = chainReturning('order', {
      data: [
        {
          id: 'r1', external_route_id: 'DT-1', route_date: '2026-09-03',
          status: 'loading', load_position_id: 'pos-1', load_position_released_at: null,
          load_positions: [{ code: 'POS-04', label: 'A3 Sur Oriente' }],
        },
      ],
      error: null,
    });
    const dispatchesChain = chainReturning('is', { data: [{ id: 'd1', route_id: 'r1', order_id: 'o1' }], error: null });
    const packagesChain = chainReturning('is', {
      data: [
        { order_id: 'o1', loaded_at: '2026-09-03T10:50:00Z', loaded_by: 'u1', status: 'en_carga' },
        { order_id: 'o1', loaded_at: null, loaded_by: null, status: 'sectorizado' },
      ],
      error: null,
    });
    const usersChain = chainReturning('is', { data: [{ id: 'u1', full_name: 'Ana Soto' }], error: null });
    mockFrom.mockReturnValueOnce(routesChain).mockReturnValueOnce(dispatchesChain)
      .mockReturnValueOnce(packagesChain).mockReturnValueOnce(usersChain);

    const { result } = renderHook(() => useLoadingMonitor('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.routes).toEqual([
      {
        id: 'r1', externalRouteId: 'DT-1', routeDate: '2026-09-03', status: 'loading',
        loadPositionCode: 'POS-04', loadPositionLabel: 'A3 Sur Oriente',
        packagesTotal: 2, packagesLoaded: 1,
        firstScanAtIso: '2026-09-03T10:50:00Z', lastScanAtIso: '2026-09-03T10:50:00Z',
      },
    ]);
    expect(result.current.data?.crew).toEqual([
      {
        userId: 'u1', fullName: 'Ana Soto', routeId: 'r1', loadPositionLabel: 'A3 Sur Oriente',
        scanCount: 1, firstScanAtIso: '2026-09-03T10:50:00Z', lastScanAtIso: '2026-09-03T10:50:00Z',
      },
    ]);
    expect(result.current.data?.packagesWaitingOnDock).toBe(1);
  });

  it('renders no andén when the load position has been released, even though the FK is still set', async () => {
    const routesChain = chainReturning('order', {
      data: [
        {
          id: 'r1', external_route_id: 'DT-1', route_date: '2026-09-03',
          status: 'draft', load_position_id: 'pos-1', load_position_released_at: '2026-09-03T09:00:00Z',
          load_positions: { code: 'POS-04', label: 'A3' },
        },
      ],
      error: null,
    });
    const dispatchesChain = chainReturning('is', { data: [], error: null });
    mockFrom.mockReturnValueOnce(routesChain).mockReturnValueOnce(dispatchesChain);

    const { result } = renderHook(() => useLoadingMonitor('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.routes[0].loadPositionLabel).toBeNull();
    expect(result.current.data?.routes[0].loadPositionCode).toBeNull();
  });

  it('fires every chunk of a chunked read in parallel, not one-at-a-time (I3)', async () => {
    // 150 routes -> 2 route-id chunks for the dispatches read. Each chunk's
    // final `.is()` call is a manually-controlled deferred promise; if the
    // hook awaited chunk 1 before even STARTING chunk 2 (a `for…await`
    // loop), chunk 2's mock would not have been invoked yet when we check
    // — with Promise.all, both are in flight immediately.
    const routeIds = Array.from({ length: 150 }, (_, i) => `r${i}`);
    const routesChain = chainReturning('order', {
      data: routeIds.map((id) => ({
        id, external_route_id: id, route_date: '2026-09-03', status: 'draft',
        load_position_id: null, load_position_released_at: null, load_positions: null,
      })),
      error: null,
    });

    let resolveChunk1!: (v: unknown) => void;
    let resolveChunk2!: (v: unknown) => void;
    const chunk1Promise = new Promise((r) => { resolveChunk1 = r; });
    const chunk2Promise = new Promise((r) => { resolveChunk2 = r; });

    function chainReturningPromise(promise: Promise<unknown>) {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'gte', 'is']) {
        chain[m] = m === 'is' ? vi.fn().mockReturnValue(promise) : vi.fn().mockReturnValue(chain);
      }
      return chain;
    }
    const dispatchesChunk1 = chainReturningPromise(chunk1Promise);
    const dispatchesChunk2 = chainReturningPromise(chunk2Promise);

    mockFrom
      .mockReturnValueOnce(routesChain)
      .mockReturnValueOnce(dispatchesChunk1)
      .mockReturnValueOnce(dispatchesChunk2);

    renderHook(() => useLoadingMonitor('op-1'), { wrapper: wrapper() });

    // Both chunk queries must already have been dispatched before EITHER
    // resolves — proof they run concurrently, not sequentially.
    await waitFor(() => expect(mockFrom).toHaveBeenCalledTimes(3));

    resolveChunk1({ data: [], error: null });
    resolveChunk2({ data: [], error: null });
  });
});
