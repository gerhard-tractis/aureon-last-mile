import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCapacityCalendar } from './useCapacityCalendar';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const MOCK_CAPACITY_ROW = {
  capacity_date: '2026-03-01',
  daily_capacity: 100,
  actual_orders: 80,
  utilization_pct: 80,
  source: 'manual' as const,
};

describe('useCapacityCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useCapacityCalendar(null, 'client-1', '2026-03'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('is disabled when clientId is null', () => {
    const { result } = renderHook(
      () => useCapacityCalendar('op-1', null, '2026-03'),
      { wrapper: createWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls get_capacity_utilization RPC with correct date range for month', async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_CAPACITY_ROW], error: null });

    const { result } = renderHook(
      () => useCapacityCalendar('op-1', 'client-1', '2026-03'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_capacity_utilization', {
      p_operator_id: 'op-1',
      p_client_id: 'client-1',
      p_date_from: '2026-03-01',
      p_date_to: '2026-03-31',
    });
  });

  it('returns capacity rows on success', async () => {
    mockRpc.mockResolvedValue({ data: [MOCK_CAPACITY_ROW], error: null });

    const { result } = renderHook(
      () => useCapacityCalendar('op-1', 'client-1', '2026-03'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].capacity_date).toBe('2026-03-01');
    expect(result.current.data![0].utilization_pct).toBe(80);
  });

  it('returns empty array when RPC returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(
      () => useCapacityCalendar('op-1', 'client-1', '2026-03'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('throws when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(
      () => useCapacityCalendar('op-1', 'client-1', '2026-03'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('derives correct last day for February in a leap year', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useCapacityCalendar('op-1', 'client-1', '2024-02'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_capacity_utilization', expect.objectContaining({
      p_date_from: '2024-02-01',
      p_date_to: '2024-02-29',
    }));
  });
});
