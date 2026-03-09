import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    rpc: mockRpc,
  }),
}));

import { useOtifMetrics, usePendingOrders } from './useDeliveryMetrics';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useOtifMetrics', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns OTIF data on success', async () => {
    const mockData = {
      total_orders: 100,
      delivered_orders: 80,
      failed_orders: 10,
      pending_orders: 10,
      on_time_deliveries: 75,
      otif_percentage: 93.8,
    };
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useOtifMetrics('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_otif_metrics', {
      p_operator_id: 'op-1',
      p_start_date: '2026-03-01',
      p_end_date: '2026-03-09',
    });
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useOtifMetrics(null, '2026-03-01', '2026-03-09'),
      { wrapper }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

    const { result } = renderHook(
      () => useOtifMetrics('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePendingOrders', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns pending orders summary on success', async () => {
    const mockData = {
      overdue_count: 12,
      due_today_count: 5,
      due_tomorrow_count: 8,
      total_pending: 25,
    };
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => usePendingOrders('op-1'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_pending_orders_summary', {
      p_operator_id: 'op-1',
    });
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => usePendingOrders(null),
      { wrapper }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});
