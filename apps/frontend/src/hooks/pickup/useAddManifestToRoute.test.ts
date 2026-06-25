import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useAddManifestToRoute } from './useAddManifestToRoute';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useAddManifestToRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes add_manifest_to_route RPC', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'm-1', pickup_route_id: 'r-1' }, error: null });

    const { result } = renderHook(() => useAddManifestToRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r-1', manifestId: 'm-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('add_manifest_to_route', {
      p_route_id: 'r-1',
      p_manifest_id: 'm-1',
    });
  });

  it('surfaces RPC error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'manifest already linked to another route' },
    });

    const { result } = renderHook(() => useAddManifestToRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ routeId: 'r-1', manifestId: 'm-1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
