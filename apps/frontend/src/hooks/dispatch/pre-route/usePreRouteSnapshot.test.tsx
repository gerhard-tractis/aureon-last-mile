import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePreRouteSnapshot } from './usePreRouteSnapshot';
import type { PreRouteSnapshot } from '@/lib/types';

const MOCK_SNAPSHOT: PreRouteSnapshot = {
  generated_at: '2026-04-23T12:00:00Z',
  totals: { order_count: 3, package_count: 5, anden_count: 2, split_dock_zone_order_count: 0 },
  andenes: [
    {
      id: 'zone-1',
      name: 'Andén Norte',
      comunas_list: ['TestComuna Norte'],
      order_count: 2,
      package_count: 3,
      comunas: [],
      order_ids: ['ord-1', 'ord-2'],
      has_split_dock_zone_warnings: false,
    },
  ],
  unmapped_comunas: [],
};

let mockRpcResult: { data: unknown; error: unknown } = { data: MOCK_SNAPSHOT, error: null };
let mockSupabase: { rpc: ReturnType<typeof vi.fn> };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpcResult = { data: MOCK_SNAPSHOT, error: null };
  mockSupabase = {
    rpc: vi.fn().mockImplementation(() => Promise.resolve(mockRpcResult)),
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('usePreRouteSnapshot', () => {
  it('is idle when operatorId is null', () => {
    const { result } = renderHook(
      () => usePreRouteSnapshot(null, '2026-04-23'),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls get_pre_route_snapshot with correct args', async () => {
    const { result } = renderHook(
      () => usePreRouteSnapshot('op-1', '2026-04-23'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_pre_route_snapshot', {
      p_operator_id: 'op-1',
      p_delivery_date: '2026-04-23',
      p_window_start: null,
      p_window_end: null,
    });
  });

  it('passes window params when provided', async () => {
    renderHook(
      () => usePreRouteSnapshot('op-1', '2026-04-23', '00:00', '12:00'),
      { wrapper },
    );
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_pre_route_snapshot', {
      p_operator_id: 'op-1',
      p_delivery_date: '2026-04-23',
      p_window_start: '00:00',
      p_window_end: '12:00',
    });
  });

  it('returns parsed snapshot on success', async () => {
    const { result } = renderHook(
      () => usePreRouteSnapshot('op-1', '2026-04-23'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces error state when rpc fails', async () => {
    mockRpcResult = { data: null, error: { message: 'DB error' } };

    const { result } = renderHook(
      () => usePreRouteSnapshot('op-1', '2026-04-23'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.snapshot).toBeNull();
  });

  it('uses query key scoped to operator, date, and window', async () => {
    // Two hooks with different dates must not share cache
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const W = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const hook1 = renderHook(() => usePreRouteSnapshot('op-1', '2026-04-23'), { wrapper: W });
    const hook2 = renderHook(() => usePreRouteSnapshot('op-1', '2026-04-24'), { wrapper: W });

    await waitFor(() => expect(hook1.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(hook2.result.current.isSuccess).toBe(true));

    // rpc called twice (separate cache entries)
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
  });
});
