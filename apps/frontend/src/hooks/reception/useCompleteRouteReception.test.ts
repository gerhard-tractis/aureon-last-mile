import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useCompleteRouteReception } from './useCompleteRouteReception';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useCompleteRouteReception', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls complete_route_reception RPC with route id', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'rr1', status: 'completed' }, error: null });

    const { result } = renderHook(() => useCompleteRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('complete_route_reception', {
      p_route_id: 'r1',
      p_discrepancy_notes: null,
    });
  });

  it('passes discrepancy notes when provided', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'rr1', status: 'completed' }, error: null });

    const { result } = renderHook(() => useCompleteRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1', discrepancyNotes: '2 paquetes faltantes' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('complete_route_reception', {
      p_route_id: 'r1',
      p_discrepancy_notes: '2 paquetes faltantes',
    });
  });

  it('surfaces RPC error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'discrepancy notes required when received < expected' },
    });

    const { result } = renderHook(() => useCompleteRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/discrepancy/);
  });
});
