import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useRemoveManifestFromRoute } from './useRemoveManifestFromRoute';

function wrapperFactory(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('useRemoveManifestFromRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls remove_manifest_from_route with the route id and manifest id', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'm1', status: 'pending' }, error: null });
    const { result } = renderHook(() => useRemoveManifestFromRoute('op-1'), {
      wrapper: wrapperFactory(newClient()),
    });

    result.current.mutate({ routeId: 'r1', manifestId: 'm1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('remove_manifest_from_route', {
      p_route_id: 'r1',
      p_manifest_id: 'm1',
    });
  });

  it('returns the manifest row on success', async () => {
    const manifest = { id: 'm1', status: 'pending' };
    mockRpc.mockResolvedValue({ data: manifest, error: null });
    const { result } = renderHook(() => useRemoveManifestFromRoute('op-1'), {
      wrapper: wrapperFactory(newClient()),
    });

    result.current.mutate({ routeId: 'r1', manifestId: 'm1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(manifest);
  });

  /**
   * The RPC's refusal message is Spanish on purpose and the page toasts
   * err.message verbatim -- wrapping or replacing it here would break that
   * UX contract silently.
   */
  it('rethrows the RPC error message intact, including the Spanish refusal', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Solo la tripulación de esta ruta puede quitarle cargas.' },
    });
    const { result } = renderHook(() => useRemoveManifestFromRoute('op-1'), {
      wrapper: wrapperFactory(newClient()),
    });

    result.current.mutate({ routeId: 'r1', manifestId: 'm1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      'Solo la tripulación de esta ruta puede quitarle cargas.'
    );
  });

  it('invalidates route-manifests, unassigned-manifests, manifests and active-route on success', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'm1' }, error: null });
    const qc = newClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRemoveManifestFromRoute('op-1'), {
      wrapper: wrapperFactory(qc),
    });

    result.current.mutate({ routeId: 'r1', manifestId: 'm1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['pickup', 'route-manifests']));
    expect(keys).toContain(JSON.stringify(['pickup', 'unassigned-manifests', 'op-1']));
    expect(keys).toContain(JSON.stringify(['pickup', 'manifests']));
    expect(keys).toContain(JSON.stringify(['pickup', 'active-route', 'op-1']));
  });

  it('does not invalidate any queries when the RPC errors', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'manifest m1 is not attached to route r1' },
    });
    const qc = newClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRemoveManifestFromRoute('op-1'), {
      wrapper: wrapperFactory(qc),
    });

    result.current.mutate({ routeId: 'r1', manifestId: 'm1' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(spy).not.toHaveBeenCalled();
  });
});
