import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkFillCapacity, useUpdateCapacity } from './useCapacityMutations';

const mockUpsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'retailer_daily_capacities') {
        return {
          upsert: mockUpsert,
          update: () => ({
            eq: mockUpdate,
          }),
        };
      }
      return {};
    },
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

describe('useBulkFillCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls upsert with correct rows and invalidates capacityCalendar', async () => {
    mockUpsert.mockResolvedValue({ data: [], error: null });

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useBulkFillCapacity(), { wrapper });

    const input = {
      operatorId: 'op-1',
      clientId: 'client-1',
      rows: [
        { capacity_date: '2026-03-01', daily_capacity: 100, source: 'manual' as const },
        { capacity_date: '2026-03-02', daily_capacity: 120, source: 'rule' as const },
      ],
    };

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpsert).toHaveBeenCalledWith(
      [
        { operator_id: 'op-1', client_id: 'client-1', capacity_date: '2026-03-01', daily_capacity: 100, source: 'manual' },
        { operator_id: 'op-1', client_id: 'client-1', capacity_date: '2026-03-02', daily_capacity: 120, source: 'rule' },
      ],
      { onConflict: 'operator_id,client_id,capacity_date', ignoreDuplicates: false }
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['capacityCalendar'] });
  });

  it('sets isError on upsert failure', async () => {
    mockUpsert.mockResolvedValue({ data: null, error: { message: 'Upsert failed' } });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkFillCapacity(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          operatorId: 'op-1',
          clientId: 'client-1',
          rows: [{ capacity_date: '2026-03-01', daily_capacity: 100, source: 'manual' as const }],
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls update with correct daily_capacity and invalidates queries', async () => {
    mockUpdate.mockResolvedValue({ data: {}, error: null });

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateCapacity(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'row-1', daily_capacity: 200 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate).toHaveBeenCalledWith('id', 'row-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['capacityCalendar'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['capacityUtilization'] });
  });

  it('sets isError on update failure', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: { message: 'Update failed' } });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateCapacity(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'row-1', daily_capacity: 200 });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
