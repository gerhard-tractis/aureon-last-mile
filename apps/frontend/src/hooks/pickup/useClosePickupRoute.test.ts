import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useClosePickupRoute } from './useClosePickupRoute';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useClosePickupRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes close_pickup_route RPC and returns route_receptions row', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 'rr-1', pickup_route_id: 'r-1', expected_count: 5, received_count: 0, status: 'pending' },
      error: null,
    });

    const { result } = renderHook(() => useClosePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('close_pickup_route', { p_route_id: 'r-1' });
    expect(result.current.data?.expected_count).toBe(5);
  });

  it('surfaces RPC error (e.g. zero verified scans)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'cannot close route with zero verified scans' },
    });

    const { result } = renderHook(() => useClosePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r-1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
