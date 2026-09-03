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
  const methods = ['select', 'eq', 'in', 'is', 'order'];
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

  it('scopes every table read to operator_id', async () => {
    const routesChain = chainReturning('order', {
      data: [
        {
          id: 'r1', external_route_id: 'DT-1', route_date: '2026-09-03', driver_name: 'Mario González',
          status: 'loading', load_position_id: 'pos-1', load_position_released_at: null,
          created_at: '2026-09-03T08:00:00Z', updated_at: '2026-09-03T11:00:00Z',
          fleet_vehicles: { plate_number: 'JKPT-45', vehicle_type: 'Furgón' },
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
  });

  it('maps a route with its vehicle, occupied andén, and package aggregates', async () => {
    const routesChain = chainReturning('order', {
      data: [
        {
          id: 'r1', external_route_id: 'DT-1', route_date: '2026-09-03', driver_name: 'Mario González',
          status: 'loading', load_position_id: 'pos-1', load_position_released_at: null,
          created_at: '2026-09-03T08:00:00Z', updated_at: '2026-09-03T11:00:00Z',
          fleet_vehicles: [{ plate_number: 'JKPT-45', vehicle_type: 'Furgón' }],
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
        driverName: 'Mario González', vehiclePlate: 'JKPT-45', vehicleType: 'Furgón',
        loadPositionCode: 'POS-04', loadPositionLabel: 'A3 Sur Oriente',
        packagesTotal: 2, packagesLoaded: 1,
        firstScanAtIso: '2026-09-03T10:50:00Z', lastScanAtIso: '2026-09-03T10:50:00Z',
        updatedAtIso: '2026-09-03T11:00:00Z',
      },
    ]);
    expect(result.current.data?.crew).toEqual([
      { userId: 'u1', fullName: 'Ana Soto', routeId: 'r1', loadPositionLabel: 'A3 Sur Oriente', scanCount: 1, lastScanAtIso: '2026-09-03T10:50:00Z' },
    ]);
    expect(result.current.data?.packagesWaitingOnDock).toBe(1);
  });

  it('renders no andén when the load position has been released, even though the FK is still set', async () => {
    const routesChain = chainReturning('order', {
      data: [
        {
          id: 'r1', external_route_id: 'DT-1', route_date: '2026-09-03', driver_name: null,
          status: 'draft', load_position_id: 'pos-1', load_position_released_at: '2026-09-03T09:00:00Z',
          created_at: '2026-09-03T08:00:00Z', updated_at: '2026-09-03T09:00:00Z',
          fleet_vehicles: null, load_positions: { code: 'POS-04', label: 'A3' },
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
});
