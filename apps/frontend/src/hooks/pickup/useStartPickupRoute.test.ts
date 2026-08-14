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
    expect(mockRpc).toHaveBeenCalledWith('start_pickup_route', { p_vehicle_id: 'veh-1' });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('p_vehicle_label');
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
