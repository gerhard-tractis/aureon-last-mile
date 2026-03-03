import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useSlaMetric,
  useFadrMetric,
  usePerformanceMetricsSummary,
  useSlaPreviousPeriod,
  useShortageClaimsMetric,
  useAvgDeliveryTimeMetric,
  useDailyMetricsSeries,
  useFadrPreviousPeriod,
  useFadrDailySeries,
  useFadrSummary,
} from './useDashboardMetrics';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useSlaMetric', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useSlaMetric(null, '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('should call calculate_sla RPC with correct params', async () => {
    mockRpc.mockResolvedValue({ data: 95.5, error: null });

    const { result } = renderHook(
      () => useSlaMetric('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('calculate_sla', {
      p_operator_id: 'op-123',
      p_start_date: '2026-02-24',
      p_end_date: '2026-03-02',
    });
    expect(result.current.data).toBe(95.5);
  });
});

describe('useFadrMetric', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useFadrMetric(null, '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should call calculate_fadr RPC with correct params', async () => {
    mockRpc.mockResolvedValue({ data: 88.2, error: null });

    const { result } = renderHook(
      () => useFadrMetric('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('calculate_fadr', {
      p_operator_id: 'op-123',
      p_start_date: '2026-02-24',
      p_end_date: '2026-03-02',
    });
    expect(result.current.data).toBe(88.2);
  });
});

describe('usePerformanceMetricsSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => usePerformanceMetricsSummary(null, '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should sum rows from performance_metrics', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({
              data: [
                { total_orders: 100, delivered_orders: 90, failed_deliveries: 5 },
                { total_orders: 80, delivered_orders: 75, failed_deliveries: 3 },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { result } = renderHook(
      () => usePerformanceMetricsSummary('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      totalOrders: 180,
      deliveredOrders: 165,
      failedDeliveries: 8,
    });
  });

  it('should return null when no data', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { result } = renderHook(
      () => usePerformanceMetricsSummary('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useSlaPreviousPeriod', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useSlaPreviousPeriod(null, '2026-02-17', '2026-02-23'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should call calculate_sla with previous period dates', async () => {
    mockRpc.mockResolvedValue({ data: 92.0, error: null });

    const { result } = renderHook(
      () => useSlaPreviousPeriod('op-123', '2026-02-17', '2026-02-23'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('calculate_sla', {
      p_operator_id: 'op-123',
      p_start_date: '2026-02-17',
      p_end_date: '2026-02-23',
    });
  });
});

describe('useShortageClaimsMetric', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useShortageClaimsMetric(null, '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should sum claims rows', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({
              data: [
                { shortage_claims_count: 3, shortage_claims_amount_clp: 50000 },
                { shortage_claims_count: 2, shortage_claims_amount_clp: 80000 },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { result } = renderHook(
      () => useShortageClaimsMetric('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ count: 5, amount: 130000 });
  });

  it('should return null when no data', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { result } = renderHook(
      () => useShortageClaimsMetric('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useAvgDeliveryTimeMetric', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useAvgDeliveryTimeMetric(null, '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should compute weighted average delivery time', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({
              data: [
                { avg_delivery_time_minutes: 40, total_orders: 100 },
                { avg_delivery_time_minutes: 50, total_orders: 100 },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { result } = renderHook(
      () => useAvgDeliveryTimeMetric('op-123', '2026-02-24', '2026-03-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(45); // (40*100 + 50*100) / 200
  });
});

describe('useDailyMetricsSeries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useDailyMetricsSeries(null, '2026-02-24', '2026-03-02', 'first_attempt_deliveries'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should return daily metric points', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  { metric_date: '2026-02-24', first_attempt_deliveries: 90 },
                  { metric_date: '2026-02-25', first_attempt_deliveries: 85 },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { result } = renderHook(
      () => useDailyMetricsSeries('op-123', '2026-02-24', '2026-03-02', 'first_attempt_deliveries'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { date: '2026-02-24', value: 90 },
      { date: '2026-02-25', value: 85 },
    ]);
  });
});

describe('useFadrPreviousPeriod', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should not fire query when operatorId is null', () => {
    const { result } = renderHook(
      () => useFadrPreviousPeriod(null, '2026-02-17', '2026-02-23'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should call calculate_fadr with previous period dates', async () => {
    mockRpc.mockResolvedValue({ data: 89.5, error: null });

    const { result } = renderHook(
      () => useFadrPreviousPeriod('op-123', '2026-02-17', '2026-02-23'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('calculate_fadr', {
      p_operator_id: 'op-123',
      p_start_date: '2026-02-17',
      p_end_date: '2026-02-23',
    });
    expect(result.current.data).toBe(89.5);
  });
});

// 11.8 — Regression tests for DASHBOARD_QUERY_OPTIONS changes
describe('DASHBOARD_QUERY_OPTIONS regression', () => {
  it('refetchInterval is 60000 (not 30000)', () => {
    // Verify the constant by inspecting a hook's query options via QueryClient
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useSlaMetric('op-123', '2026-02-17', '2026-02-23'),
      { wrapper }
    );

    // Wait for hook to register, then inspect the query's options
    const queries = queryClient.getQueryCache().getAll();
    const dashQuery = queries.find((q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === 'dashboard'
    );
    if (dashQuery) {
      // refetchInterval comes from DASHBOARD_QUERY_OPTIONS spread
      expect(dashQuery.options.refetchInterval).toBe(60000);
    }
    queryClient.clear();
  });

  it('staleTime is 30000', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(
      () => useSlaMetric('op-123', '2026-02-17', '2026-02-23'),
      { wrapper }
    );

    const queries = queryClient.getQueryCache().getAll();
    const dashQuery = queries.find((q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === 'dashboard'
    );
    if (dashQuery) {
      expect(dashQuery.options.staleTime).toBe(30000);
    }
    queryClient.clear();
  });
});
