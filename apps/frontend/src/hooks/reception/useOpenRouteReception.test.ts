import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useOpenRouteReception } from './useOpenRouteReception';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useOpenRouteReception', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls open_route_reception with the route id', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'rr1', expected_count: 12 }, error: null });

    const { result } = renderHook(() => useOpenRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('open_route_reception', { p_route_id: 'r1' });
    expect(result.current.data).toEqual({ id: 'rr1', expected_count: 12 });
  });

  it('surfaces the RPC error message (already received / cancelled)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'La ruta PR-2026-0001 ya fue recibida en el hub' },
    });

    const { result } = renderHook(() => useOpenRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/ya fue recibida/);
  });

  it('does not call the RPC until mutate is invoked', () => {
    renderHook(() => useOpenRouteReception(), { wrapper: wrapperFactory() });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
