import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useReopenRouteReception } from './useReopenRouteReception';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useReopenRouteReception', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls reopen_pickup_route with the route id', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1', status: 'in_progress' }, error: null });

    const { result } = renderHook(() => useReopenRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('reopen_pickup_route', { p_route_id: 'r1' });
  });

  it('surfaces the named replacement-route error verbatim', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'El conductor ya tiene una ruta de retiro activa (PR-2026-0009); ciérrela o anúlela antes de reabrir PR-2026-0001',
      },
    });

    const { result } = renderHook(() => useReopenRouteReception(), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/ya tiene una ruta de retiro activa/);
  });

  it('does not call the RPC until mutate is invoked', () => {
    renderHook(() => useReopenRouteReception(), { wrapper: wrapperFactory() });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
