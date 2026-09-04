import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/supabase/client', () => ({ createSPAClient: vi.fn() }));

import { createSPAClient } from '@/lib/supabase/client';
import { useVehicleAssignmentOptions } from './useVehicleAssignmentOptions';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

function buildClient(opts: {
  vehicles?: unknown[];
  vehiclesError?: unknown;
  routes?: unknown[];
  routesError?: unknown;
}) {
  const { vehicles = [], vehiclesError = null, routes = [], routesError = null } = opts;

  const vehiclesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: vehicles, error: vehiclesError }),
  };

  const routesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: routes, error: routesError }),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === 'fleet_vehicles') return vehiclesChain;
    if (table === 'routes') return routesChain;
    throw new Error(`unexpected table ${table}`);
  });

  return { from: fromMock };
}

beforeEach(() => vi.resetAllMocks());

describe('useVehicleAssignmentOptions', () => {
  it('does not query while disabled (sheet closed) — mount-gated, not just enabled:false (rule 7)', () => {
    const client = buildClient({});
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    renderHook(() => useVehicleAssignmentOptions('route-1', 'op-1', { enabled: false }), { wrapper });

    expect(client.from).not.toHaveBeenCalled();
  });

  it('shapes fleet vehicles and today-busy routes into picker rows', async () => {
    const client = buildClient({
      vehicles: [
        {
          id: 'v1',
          external_vehicle_id: 'RTHK-72',
          plate_number: 'RTHK-72',
          vehicle_type: 'Camión 3/4',
          driver_name: 'Mario González',
          capacity_packages: 240,
        },
        {
          id: 'v2',
          external_vehicle_id: 'ZZ-01',
          plate_number: null,
          vehicle_type: 'Furgón',
          driver_name: null,
          capacity_packages: null,
        },
      ],
      routes: [
        { id: 'other-route', vehicle_id: 'v1' },
      ],
    });
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { result } = renderHook(
      () => useVehicleAssignmentOptions('route-current', 'op-1', { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'v1', assignable: false, blockReason: 'blocked' }),
      expect.objectContaining({ id: 'v2', assignable: false, blockReason: 'no_capacity' }),
    ]);
  });

  it('D1: keeps a vehicle with no external_vehicle_id in the list instead of filtering it out', async () => {
    const client = buildClient({
      vehicles: [
        {
          id: 'v3',
          external_vehicle_id: null,
          plate_number: null,
          vehicle_type: 'Furgón',
          driver_name: null,
          capacity_packages: 100,
        },
      ],
      routes: [],
    });
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { result } = renderHook(
      () => useVehicleAssignmentOptions('route-current', 'op-1', { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'v3', externalVehicleId: null, assignable: false, blockReason: 'sin_identificador' }),
    ]);
  });
});
