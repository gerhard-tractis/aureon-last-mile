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

  it('invokes start_pickup_route RPC with vehicle label', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 'r1', code: 'PR-2026-0001', status: 'in_progress' },
      error: null,
    });

    const { result } = renderHook(() => useStartPickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({ vehicleLabel: 'AAA-111' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('start_pickup_route', { p_vehicle_label: 'AAA-111' });
  });

  it('surfaces error from RPC (e.g. active route exists)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'driver already has an active pickup route' },
    });

    const { result } = renderHook(() => useStartPickupRoute('op-1'), {
      wrapper: wrapperFactory(),
    });

    result.current.mutate({});
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/already/i);
  });
});
