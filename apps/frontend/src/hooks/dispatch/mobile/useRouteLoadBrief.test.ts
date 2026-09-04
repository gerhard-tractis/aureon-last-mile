import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouteLoadBrief } from './useRouteLoadBrief';

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

interface Fixture {
  routeDriverName: string | null;
  vehicleId?: string | null;
}

/**
 * Review I2 — this hook shipped in spec-76 task 1 with no test file at
 * all. Covers the one thing that actually needed proving here: which
 * column `vehicleAssignment.driverName` comes from (review I1 — it must be
 * `routes.driver_name`, never a fleet_vehicles fallback).
 */
function buildClient({ routeDriverName, vehicleId = 'veh-1' }: Fixture) {
  const routesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        vehicle_id: vehicleId,
        driver_name: routeDriverName,
        load_position_id: null,
        load_position_released_at: null,
        load_positions: null,
      },
      error: null,
    }),
  };

  const dispatchesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({
      data: [{ order_id: 'o1', orders: { order_number: 'ORD-1', delivery_address: 'Calle 1', comuna: 'Maipú' } }],
      error: null,
    }),
  };

  const packagesChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  const fleetVehiclesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { external_vehicle_id: 'RTHK-72', capacity_packages: 200 },
      error: null,
    }),
  };

  // A benign fallback, not a throw, for any call this fixture doesn't name
  // explicitly — react-query can re-invoke the query function during test
  // teardown (garbage collection on unmount), after assertions already
  // ran; that stray call must not crash the test.
  const noopChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  mockFrom.mockImplementation((table: string) => {
    if (table === 'routes') return routesChain;
    if (table === 'dispatches') return dispatchesChain;
    if (table === 'packages') return packagesChain;
    if (table === 'fleet_vehicles') return fleetVehiclesChain;
    return noopChain;
  });
}

describe('useRouteLoadBrief — vehicleAssignment.driverName source (review I1/I2)', () => {
  beforeEach(() => mockFrom.mockReset());

  it('uses routes.driver_name when present', async () => {
    buildClient({ routeDriverName: 'Mario González' });

    const { result } = renderHook(() => useRouteLoadBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vehicleAssignment).toEqual({
      externalVehicleId: 'RTHK-72',
      driverName: 'Mario González',
    });
  });

  it('renders no driver (null), never a fleet_vehicles fallback, when routes.driver_name is null', async () => {
    buildClient({ routeDriverName: null });

    const { result } = renderHook(() => useRouteLoadBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vehicleAssignment).toEqual({
      externalVehicleId: 'RTHK-72',
      driverName: null,
    });
  });

  it('has no vehicleAssignment at all when the route has no vehicle_id', async () => {
    buildClient({ routeDriverName: null, vehicleId: null });

    const { result } = renderHook(() => useRouteLoadBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vehicleAssignment).toBeNull();
  });
});

describe('useRouteLoadBrief — spec-78 additions (vehicleCapacityPackages, orderBoxCounts)', () => {
  beforeEach(() => mockFrom.mockReset());

  it('carries fleet_vehicles.capacity_packages alongside external_vehicle_id, no second fetch', async () => {
    buildClient({ routeDriverName: 'Mario González' });

    const { result } = renderHook(() => useRouteLoadBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vehicleCapacityPackages).toBe(200);
  });

  it('is null when the route has no vehicle_id', async () => {
    buildClient({ routeDriverName: null, vehicleId: null });

    const { result } = renderHook(() => useRouteLoadBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vehicleCapacityPackages).toBeNull();
  });
});
