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

import {
  useOtifMetrics,
  usePendingOrders,
  useOtifByRetailer,
  useLateDeliveries,
  useOrdersDetail,
} from './useDeliveryMetrics';

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

describe('useOtifByRetailer', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns OTIF by retailer data on success', async () => {
    const mockData = [
      { retailer_name: 'Falabella', total_orders: 50, delivered: 45, on_time: 40, otif_pct: 88.9 },
      { retailer_name: 'Ripley', total_orders: 30, delivered: 28, on_time: 25, otif_pct: 89.3 },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useOtifByRetailer('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_otif_by_retailer', {
      p_operator_id: 'op-1',
      p_start_date: '2026-03-01',
      p_end_date: '2026-03-09',
    });
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useOtifByRetailer(null, '2026-03-01', '2026-03-09'),
      { wrapper }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useLateDeliveries', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns late deliveries on success', async () => {
    const mockData = [
      {
        order_number: 'ORD-001',
        retailer_name: 'Falabella',
        delivery_date: '2026-03-05',
        completed_date: '2026-03-07',
        days_late: 2,
        driver_name: 'Carlos',
      },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useLateDeliveries('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_late_deliveries', {
      p_operator_id: 'op-1',
      p_start_date: '2026-03-01',
      p_end_date: '2026-03-09',
    });
  });
});

describe('useOrdersDetail', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns orders detail on success', async () => {
    const mockData = {
      rows: [
        {
          id: 'uuid-1',
          order_number: 'ORD-001',
          retailer_name: 'Falabella',
          comuna: 'Las Condes',
          delivery_date: '2026-03-05',
          status: 'delivered',
          completed_at: '2026-03-05T14:30:00Z',
          driver_name: 'Carlos',
          route_id: 'route-1',
          failure_reason: null,
          days_delta: 0,
        },
      ],
      total_count: 1,
    };
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useOrdersDetail('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_orders_detail', {
      p_operator_id: 'op-1',
      p_start_date: '2026-03-01',
      p_end_date: '2026-03-09',
      p_status: null,
      p_retailer: null,
      p_search: null,
      p_overdue_only: false,
      p_page: 1,
      p_page_size: 25,
    });
  });

  it('passes filters correctly', async () => {
    mockRpc.mockResolvedValue({ data: { rows: [], total_count: 0 }, error: null });

    const filters = { status: 'failed', retailer: 'Ripley', search: 'ORD', overdueOnly: true, page: 2, pageSize: 10 };
    const { result } = renderHook(
      () => useOrdersDetail('op-1', '2026-03-01', '2026-03-09', filters),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_orders_detail', {
      p_operator_id: 'op-1',
      p_start_date: '2026-03-01',
      p_end_date: '2026-03-09',
      p_status: 'failed',
      p_retailer: 'Ripley',
      p_search: 'ORD',
      p_overdue_only: true,
      p_page: 2,
      p_page_size: 10,
    });
  });
});
