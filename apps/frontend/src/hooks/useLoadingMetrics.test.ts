import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useOrdersLoaded,
  usePackagesLoaded,
  useOrdersCommitted,
  useActiveClients,
  useComunasCovered,
  useDailyOrdersByClient,
  useCommittedOrdersDaily,
  useOrdersByClient,
  useOrdersByComuna,
} from './useLoadingMetrics';

const mockRpc = vi.fn();
const mockChain = {
  select: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
};
const mockFrom = vi.fn(() => mockChain);

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
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

const START = '2026-02-24';
const END = '2026-03-02';
const OP = 'op-123';

describe('useOrdersLoaded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain mocks to return `this`
    Object.values(mockChain).forEach(fn => fn.mockReturnThis());
  });

  it('should not fire when operatorId is null', () => {
    const { result } = renderHook(() => useOrdersLoaded(null, START, END), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should return count from supabase', async () => {
    // The last chained call resolves with count
    mockChain.is.mockResolvedValue({ count: 42, error: null });

    const { result } = renderHook(() => useOrdersLoaded(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(42);
    expect(mockFrom).toHaveBeenCalledWith('orders');
  });
});

describe('usePackagesLoaded', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return packages_count and avg_per_order', async () => {
    mockRpc.mockResolvedValue({
      data: { packages_count: 100, avg_per_order: 2.5 },
      error: null,
    });

    const { result } = renderHook(() => usePackagesLoaded(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ packages_count: 100, avg_per_order: 2.5 });
    expect(mockRpc).toHaveBeenCalledWith('get_packages_loaded_stats', {
      p_start_date: START,
      p_end_date: END,
    });
  });
});

describe('useOrdersCommitted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockChain).forEach(fn => fn.mockReturnThis());
  });

  it('should return count for committed orders', async () => {
    mockChain.is.mockResolvedValue({ count: 35, error: null });

    const { result } = renderHook(() => useOrdersCommitted(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(35);
  });
});

describe('useActiveClients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockChain).forEach(fn => fn.mockReturnThis());
  });

  it('should return unique retailer count', async () => {
    mockChain.not.mockResolvedValue({
      data: [
        { retailer_name: 'A' },
        { retailer_name: 'B' },
        { retailer_name: 'A' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useActiveClients(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(2);
  });
});

describe('useComunasCovered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockChain).forEach(fn => fn.mockReturnThis());
  });

  it('should return unique comuna count', async () => {
    mockChain.not.mockResolvedValue({
      data: [
        { comuna: 'Santiago' },
        { comuna: 'Providencia' },
        { comuna: 'Santiago' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useComunasCovered(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(2);
  });
});

describe('useOrdersByClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return array with retailer breakdown', async () => {
    const mockData = [
      { retailer_name: 'Store A', orders: 50, packages: 120, pct: 45.5 },
      { retailer_name: 'Store B', orders: 60, packages: 130, pct: 54.5 },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => useOrdersByClient(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_orders_by_client', {
      p_start_date: START,
      p_end_date: END,
    });
  });
});

describe('useDailyOrdersByClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return daily orders array', async () => {
    const mockData = [{ day: '2026-02-24', retailer_name: 'A', count: 10 }];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => useDailyOrdersByClient(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
  });
});

describe('useCommittedOrdersDaily', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return committed daily array', async () => {
    const mockData = [{ day: '2026-02-24', count: 15 }];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => useCommittedOrdersDaily(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
  });

  // Guard: the RPC filters by created_at (load date) via p_start_date/p_end_date,
  // then groups by delivery_date. If a future migration regresses the SQL to filter
  // by delivery_date instead, this test documents the correct contract.
  it('should pass date range as p_start_date/p_end_date for created_at filtering', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useCommittedOrdersDaily(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_committed_orders_daily', {
      p_start_date: START,
      p_end_date: END,
    });
  });
});

describe('useOrdersByComuna', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should pass region param', async () => {
    const mockData = [{ comuna: 'Santiago', count: 20, pct: 100 }];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useOrdersByComuna(OP, START, END, 'RM'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_orders_by_comuna', {
      p_start_date: START,
      p_end_date: END,
      p_region: 'RM',
    });
  });

  it('should pass null region when not provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useOrdersByComuna(OP, START, END), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_orders_by_comuna', {
      p_start_date: START,
      p_end_date: END,
      p_region: null,
    });
  });
});
