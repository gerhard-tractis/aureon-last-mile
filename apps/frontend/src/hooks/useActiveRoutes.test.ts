import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useActiveRoutes, type ActiveRoute } from './useActiveRoutes';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
}

const MOCK_ROUTE: ActiveRoute = {
  id: 'route-1',
  external_route_id: '12345',
  driver_name: 'Juan Pérez',
  vehicle_id: 'vehicle-1',
  status: 'in_progress',
  start_time: '2026-03-10T08:00:00',
  total_stops: 10,
  completed_stops: 4,
  dispatches: [
    {
      id: 'dispatch-1',
      external_dispatch_id: '67890',
      order_id: 'order-1',
      status: 'pending',
      planned_sequence: 5,
      estimated_at: '2026-03-10T11:30:00',
      arrived_at: null,
      completed_at: null,
      latitude: null,
      longitude: null,
      failure_reason: null,
    },
  ],
};

describe('useActiveRoutes', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns active routes for today', async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_ROUTE], error: null });

    const { result } = renderHook(() => useActiveRoutes('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].external_route_id).toBe('12345');
    expect(result.current.data![0].driver_name).toBe('Juan Pérez');
    expect(result.current.data![0].dispatches).toHaveLength(1);
  });

  it('passes routeDate to RPC when provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useActiveRoutes('op-1', '2026-03-09'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_active_routes_with_dispatches', {
      p_operator_id: 'op-1',
      p_route_date: '2026-03-09',
    });
  });

  it('returns empty array when no routes', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useActiveRoutes('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when operatorId is empty', () => {
    const { result } = renderHook(() => useActiveRoutes(''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => useActiveRoutes('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
