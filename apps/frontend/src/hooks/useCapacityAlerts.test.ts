import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCapacityAlerts, useDismissAlert } from './useCapacityAlerts';

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'capacity_alerts') {
        return {
          select: () => ({
            is: () => ({
              is: () => ({
                order: mockSelect,
              }),
            }),
          }),
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
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

const MOCK_ALERT = {
  id: 'alert-1',
  operator_id: 'op-1',
  client_id: 'client-1',
  alert_type: 'over_capacity',
  capacity_date: '2026-03-15',
  threshold_pct: 90,
  actual_pct: 95,
  dismissed_at: null,
  deleted_at: null,
  created_at: '2026-03-15T10:00:00Z',
};

describe('useCapacityAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when operatorId is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCapacityAlerts(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns capacity alerts on success', async () => {
    mockSelect.mockResolvedValue({ data: [MOCK_ALERT], error: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCapacityAlerts('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe('alert-1');
    expect(result.current.data![0].alert_type).toBe('over_capacity');
  });

  it('returns empty array when no alerts', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCapacityAlerts('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    mockSelect.mockResolvedValue({ data: null, error: null });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCapacityAlerts('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('throws when query returns error', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCapacityAlerts('op-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDismissAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls update with dismissed_at and invalidates capacityAlerts', async () => {
    mockUpdate.mockResolvedValue({ data: {}, error: null });

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDismissAlert(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('alert-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate).toHaveBeenCalledWith('id', 'alert-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['capacityAlerts'] });
  });

  it('sets isError on DB failure', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: { message: 'Update failed' } });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDismissAlert(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync('alert-1');
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
