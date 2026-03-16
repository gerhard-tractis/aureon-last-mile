import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

// Mock supabase client
const mockUnsubscribe = vi.fn();
const mockSubscribe = vi.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
const mockOn = vi.fn().mockReturnThis();
const mockChannel = vi.fn().mockReturnValue({
  on: mockOn,
  subscribe: mockSubscribe,
});
const mockRemoveChannel = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  }),
}));

import { useRealtimeOrders } from './useRealtimeOrders';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useRealtimeOrders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockOn.mockReturnThis();
    mockSubscribe.mockReturnValue({ unsubscribe: mockUnsubscribe });
    mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to orders channel for operator on mount', () => {
    renderHook(() => useRealtimeOrders('op-123'), { wrapper });

    expect(mockChannel).toHaveBeenCalledWith('operator:op-123:orders');
    expect(mockOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: 'operator_id=eq.op-123',
      }),
      expect.any(Function),
    );
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('removes channel on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeOrders('op-123'), { wrapper });
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});
