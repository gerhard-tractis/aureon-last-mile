import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useOperationsOrders, type OperationsOrder } from './useOperationsOrders';
import type { OpsControlFilterState } from '@/lib/stores/useOpsControlFilterStore';

const mockFrom = vi.fn();

// Build a chainable mock
function buildChain(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(finalValue));
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
}

const MOCK_ORDER: OperationsOrder = {
  id: 'order-1',
  order_number: 'ORD-001',
  retailer_name: 'Retailer A',
  customer_name: 'John Doe',
  comuna: 'Las Condes',
  delivery_date: '2026-03-16',
  delivery_window_start: '2026-03-16T10:00:00',
  delivery_window_end: '2026-03-16T12:00:00',
  status: 'en_ruta',
  leading_status: 'en_ruta',
  status_updated_at: '2026-03-16T09:00:00',
  operator_id: 'op-1',
  deleted_at: null,
};

const DEFAULT_FILTERS: Pick<
  OpsControlFilterState,
  'datePreset' | 'dateRange' | 'statusFilter' | 'stageFilter'
> = {
  datePreset: 'today',
  dateRange: null,
  statusFilter: 'all',
  stageFilter: null,
};

describe('useOperationsOrders', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('returns orders for operator', async () => {
    const chain = buildChain({ data: [MOCK_ORDER], error: null });
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOperationsOrders('op-1', DEFAULT_FILTERS),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].order_number).toBe('ORD-001');
    expect(result.current.data![0].status).toBe('en_ruta');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useOperationsOrders(null, DEFAULT_FILTERS),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws when query returns error', async () => {
    const chain = buildChain({ data: null, error: { message: 'DB error' } });
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOperationsOrders('op-1', DEFAULT_FILTERS),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('calls from orders table', async () => {
    const chain = buildChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOperationsOrders('op-1', DEFAULT_FILTERS),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith('orders');
  });

  it('applies stageFilter when set', async () => {
    const chain = buildChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const filters = { ...DEFAULT_FILTERS, stageFilter: 'en_ruta' as const };

    const { result } = renderHook(
      () => useOperationsOrders('op-1', filters),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Chain .eq should have been called with 'status', 'en_ruta'
    expect(chain.eq).toHaveBeenCalledWith('status', 'en_ruta');
  });

  it('returns empty array when no orders', async () => {
    const chain = buildChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useOperationsOrders('op-1', DEFAULT_FILTERS),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('uses tomorrow date for tomorrow preset', async () => {
    const chain = buildChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const filters = { ...DEFAULT_FILTERS, datePreset: 'tomorrow' as const };

    const { result } = renderHook(
      () => useOperationsOrders('op-1', filters),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should filter by a date string (tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    expect(chain.gte).toHaveBeenCalledWith('delivery_date', tomorrowStr);
    expect(chain.lte).toHaveBeenCalledWith('delivery_date', tomorrowStr);
  });

  it('uses custom date range when preset is custom', async () => {
    const chain = buildChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const filters = {
      ...DEFAULT_FILTERS,
      datePreset: 'custom' as const,
      dateRange: { from: '2026-03-10', to: '2026-03-20' },
    };

    const { result } = renderHook(
      () => useOperationsOrders('op-1', filters),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(chain.gte).toHaveBeenCalledWith('delivery_date', '2026-03-10');
    expect(chain.lte).toHaveBeenCalledWith('delivery_date', '2026-03-20');
  });

  it('filters with next7 preset: today to today+6 days', async () => {
    const chain = buildChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const filters = { ...DEFAULT_FILTERS, datePreset: 'next7' as const };

    const { result } = renderHook(
      () => useOperationsOrders('op-1', filters),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const next6 = new Date();
    next6.setDate(next6.getDate() + 6);
    const next6Str = next6.toISOString().split('T')[0];

    expect(chain.gte).toHaveBeenCalledWith('delivery_date', todayStr);
    expect(chain.lte).toHaveBeenCalledWith('delivery_date', next6Str);
  });
});
