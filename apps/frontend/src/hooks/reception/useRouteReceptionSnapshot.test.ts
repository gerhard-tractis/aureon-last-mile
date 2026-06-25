import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useRouteReceptionSnapshot } from './useRouteReceptionSnapshot';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useRouteReceptionSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fire when routeId is null', () => {
    renderHook(() => useRouteReceptionSnapshot(null), { wrapper: wrapperFactory() });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls get_route_reception_snapshot RPC with route id', async () => {
    mockRpc.mockResolvedValue({
      data: {
        route: { id: 'r1', code: 'PR-2026-0001', driver_id: 'd1', driver_name: 'Ana', vehicle_label: null, status: 'in_transit', in_transit_at: null },
        route_reception: { id: 'rr1', status: 'pending', expected_count: 5, received_count: 0, started_at: null, completed_at: null, discrepancy_notes: null },
        manifests: [],
        expected_packages: [],
        scans: [],
        discrepancies: [],
      },
      error: null,
    });

    const { result } = renderHook(() => useRouteReceptionSnapshot('r1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_route_reception_snapshot', { p_route_id: 'r1' });
    expect(result.current.data?.route.code).toBe('PR-2026-0001');
  });

  it('surfaces RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const { result } = renderHook(() => useRouteReceptionSnapshot('rX'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/not found/);
  });
});
