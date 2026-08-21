import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useCancelPickupRoute } from './useCancelPickupRoute';

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

describe('useCancelPickupRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls cancel_pickup_route with the route id and a reason', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1', status: 'cancelled' }, error: null });
    const { result } = renderHook(() => useCancelPickupRoute('op-1'), {
      wrapper: wrapperFactory(newClient()),
    });

    result.current.mutate({ routeId: 'r1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // p_reason lands in `pickup_routes.cancellation_reason` (migration
    // 20260812000003 PART 7). Sending '' there would store NULL and leave
    // the audit trail unable to say who abandoned the route or why.
    expect(mockRpc).toHaveBeenCalledWith('cancel_pickup_route', {
      p_route_id: 'r1',
      p_reason: 'Cancelada por el líder de la ruta',
    });
  });

  it('sends a caller-supplied reason instead of the default when given one', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const { result } = renderHook(() => useCancelPickupRoute('op-1'), {
      wrapper: wrapperFactory(newClient()),
    });

    result.current.mutate({ routeId: 'r1', reason: 'Camión averiado' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('cancel_pickup_route', {
      p_route_id: 'r1',
      p_reason: 'Camión averiado',
    });
  });

  /**
   * Cancelling detaches the manifests and nulls their `reception_status`
   * (the route-status trigger, 20260820000002), so the loads reappear in
   * `get_pending_manifests`. Without this invalidation the leader is left
   * looking at a pending list that still hides the loads they just freed,
   * and would conclude the cancel did nothing.
   */
  it('invalidates the pending list, the route and its manifests', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const qc = newClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCancelPickupRoute('op-1'), {
      wrapper: wrapperFactory(qc),
    });

    result.current.mutate({ routeId: 'r1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['pickup', 'manifests']));
    expect(keys).toContain(JSON.stringify(['pickup', 'active-route', 'op-1']));
    expect(keys).toContain(JSON.stringify(['pickup', 'route-manifests']));
  });

  it('surfaces the RPC error message verbatim', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'cannot cancel route in status closed' },
    });
    const { result } = renderHook(() => useCancelPickupRoute('op-1'), {
      wrapper: wrapperFactory(newClient()),
    });

    result.current.mutate({ routeId: 'r1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('cannot cancel route in status closed');
  });
});
