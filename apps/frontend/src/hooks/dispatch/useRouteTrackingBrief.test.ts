import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouteTrackingBrief } from './useRouteTrackingBrief';

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
  routeDriverName?: string | null;
  vehicleId?: string | null;
  dispatchRows?: unknown[];
  packageRows?: unknown[];
  scannerFullName?: string | null;
}

function buildClient({
  routeDriverName = 'Mario González',
  vehicleId = 'veh-1',
  dispatchRows = [
    { order_id: 'o1', orders: { order_number: 'ORD-1', comuna: 'Maipú', delivery_address: 'Calle 1', customer_name: 'Ana' } },
  ],
  packageRows = [
    { id: 'p1', order_id: 'o1', label: 'LBL-1', loaded_at: '2026-09-04T10:00:00Z', loaded_by: 'u1', status: 'en_carga' },
  ],
  scannerFullName = 'Juan Pérez',
}: Fixture) {
  const routesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        route_date: '2026-09-04',
        driver_name: routeDriverName,
        vehicle_id: vehicleId,
        load_position_id: 'lp-1',
        load_position_released_at: null,
        load_positions: { code: 'A3', label: 'Andén A3' },
      },
      error: null,
    }),
  };

  const dispatchesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: dispatchRows, error: null }),
  };

  const packagesChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: packageRows, error: null }),
  };

  const fleetVehiclesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { external_vehicle_id: 'RTHK-72', capacity_packages: 180 }, error: null }),
  };

  const usersChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: scannerFullName ? { full_name: scannerFullName } : null, error: null }),
  };

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
    if (table === 'users') return usersChain;
    return noopChain;
  });
}

describe('useRouteTrackingBrief', () => {
  beforeEach(() => mockFrom.mockReset());

  it('assembles the tracking brief from route, dispatches, packages, vehicle and scanner rows', async () => {
    buildClient({});
    const { result } = renderHook(() => useRouteTrackingBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      routeDate: '2026-09-04',
      loadPositionLabel: 'Andén A3',
      scannerName: 'Juan Pérez',
      vehicleExternalId: 'RTHK-72',
      driverName: 'Mario González',
      vehicleCapacityPackages: 180,
      packagesLoadedCount: 1,
      packagesExpectedCount: 1,
    });
    expect(result.current.data?.scans).toHaveLength(1);
    expect(result.current.data?.scans[0]).toMatchObject({ orderNumber: 'ORD-1', comuna: 'Maipú', customerName: 'Ana' });
  });

  it('uses routes.driver_name only, never a fleet_vehicles fallback, when null', async () => {
    buildClient({ routeDriverName: null });
    const { result } = renderHook(() => useRouteTrackingBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.driverName).toBeNull();
  });

  it('reports vehicleCapacityPackages as null when unconfigured, not a guessed number', async () => {
    buildClient({});
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              route_date: '2026-09-04', driver_name: 'X', vehicle_id: 'veh-1',
              load_position_id: null, load_position_released_at: null, load_positions: null,
            },
            error: null,
          }),
        };
      }
      if (table === 'dispatches') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue({ data: [], error: null }) };
      if (table === 'fleet_vehicles') {
        return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { external_vehicle_id: 'RTHK-72', capacity_packages: null }, error: null }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const { result } = renderHook(() => useRouteTrackingBrief('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.vehicleCapacityPackages).toBeNull();
    expect(result.current.data?.loadPositionLabel).toBeNull();
  });

  it('does not fetch when disabled', () => {
    buildClient({});
    renderHook(() => useRouteTrackingBrief('r1', 'op-1', false), { wrapper: wrapper() });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
