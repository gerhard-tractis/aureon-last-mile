import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCreateManualOrder } from './useOrders';

const mockInsert = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: mockInsert,
        }),
      }),
    }),
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useCreateManualOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates [dashboard] queries on success', async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    mockInsert.mockResolvedValue({ data: { id: '1', order_number: 'ORD-001' }, error: null });

    const { result } = renderHook(() => useCreateManualOrder(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        formData: {
          order_number: 'ORD-001',
          customer_name: 'Test',
          customer_phone: '+56912345678',
          delivery_address: 'Test St 123',
          comuna: 'Santiago',
          delivery_date: '2026-03-10',
          delivery_window_start: null,
          delivery_window_end: null,
          retailer_name: null,
        },
        operatorId: 'op-123',
        userId: 'user-123',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    queryClient.clear();
  });

  it('does NOT invalidate [dashboard] on error', async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    mockInsert.mockResolvedValue({ data: null, error: new Error('DB error') });

    const { result } = renderHook(() => useCreateManualOrder(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          formData: {
            order_number: 'ORD-001',
            customer_name: 'Test',
            customer_phone: '+56912345678',
            delivery_address: 'Test St 123',
            comuna: 'Santiago',
            delivery_date: '2026-03-10',
            delivery_window_start: null,
            delivery_window_end: null,
            retailer_name: null,
          },
          operatorId: 'op-123',
          userId: 'user-123',
        });
      } catch {
        // expected
      }
    });

    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    queryClient.clear();
  });
});
