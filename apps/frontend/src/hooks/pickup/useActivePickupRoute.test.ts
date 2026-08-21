import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useActivePickupRoute } from './useActivePickupRoute';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

const ROUTE = {
  id: 'route-1',
  operator_id: 'op-1',
  driver_id: 'driver-1',
  code: 'PR-2026-0001',
  status: 'in_progress',
  plate: 'AAA-111',
  driver_name: 'M. Rojas',
  crew: [{ user_id: 'crew-1', full_name: 'Ana Pérez' }],
};

describe('useActivePickupRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('returns null when the caller is on no route', async () => {
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  // spec-61: "my route" is resolved server-side as leader OR active crew.
  // One call, no second query to pickup_route_crew — a crew member on a
  // route their colleague opened must land on 3h, not 3j.
  it('resolves the route in a single RPC call', async () => {
    mockRpc.mockResolvedValue({ data: ROUTE, error: null });
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_my_active_pickup_route', undefined);
    expect(result.current.data?.id).toBe('route-1');
  });

  it('surfaces the plate and the driver name in the shape the screens read', async () => {
    mockRpc.mockResolvedValue({ data: ROUTE, error: null });
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.vehicle?.plate).toBe('AAA-111');
    expect(result.current.data?.driver?.full_name).toBe('M. Rojas');
    // The flat RPC fields must not leak through onto the route object — the
    // screens read `vehicle`/`driver`, and a passthrough would hide a
    // mapping that never ran.
    expect(result.current.data).not.toHaveProperty('plate');
    expect(result.current.data).not.toHaveProperty('driver_name');
  });

  it('leaves vehicle null when the vehicle row is gone', async () => {
    mockRpc.mockResolvedValue({ data: { ...ROUTE, plate: null }, error: null });
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.vehicle).toBeNull();
  });

  it('carries the crew for 3h', async () => {
    mockRpc.mockResolvedValue({ data: ROUTE, error: null });
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.crew).toEqual([
      { user_id: 'crew-1', full_name: 'Ana Pérez' },
    ]);
  });

  it('defaults crew to an empty array when the RPC omits it', async () => {
    const { crew: _drop, ...noCrew } = ROUTE;
    mockRpc.mockResolvedValue({ data: noCrew, error: null });
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.crew).toEqual([]);
  });

  it('surfaces an RPC error instead of reporting no route', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const { result } = renderHook(() => useActivePickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useActivePickupRoute(null), { wrapper: wrapperFactory() });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
