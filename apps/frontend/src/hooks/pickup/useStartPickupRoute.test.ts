import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useStartPickupRoute } from './useStartPickupRoute';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useStartPickupRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes start_pickup_route RPC with the vehicle id, never a label', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 'r1', code: 'PR-2026-0001', status: 'in_progress' },
      error: null,
    });

    const { result } = renderHook(() => useStartPickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ vehicleId: 'veh-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // spec-61: crew is always sent, so the caller never depends on the SQL
    // DEFAULT — an omitted argument and an empty crew must not be two
    // different code paths.
    expect(mockRpc).toHaveBeenCalledWith('start_pickup_route', {
      p_vehicle_id: 'veh-1',
      p_crew_user_ids: [],
    });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('p_vehicle_label');
  });

  // spec-61 Task 5 — the crew the leader ticked on 3j must reach the RPC,
  // which inserts the seats in the same transaction as the route.
  it('passes the chosen crew through to start_pickup_route', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1' }, error: null });

    const { result } = renderHook(() => useStartPickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ vehicleId: 'veh-1', crewUserIds: ['u1', 'u2'] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('start_pickup_route', {
      p_vehicle_id: 'veh-1',
      p_crew_user_ids: ['u1', 'u2'],
    });
  });

  it('surfaces the named RPC error message (e.g. active route exists)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'El conductor ya tiene una ruta activa' },
    });

    const { result } = renderHook(() => useStartPickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ vehicleId: 'veh-1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('El conductor ya tiene una ruta activa');
  });

  it('surfaces the vehicle validation error raised by the RPC', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'El vehículo no está activo' },
    });

    const { result } = renderHook(() => useStartPickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ vehicleId: 'veh-inactive' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('El vehículo no está activo');
  });
});
