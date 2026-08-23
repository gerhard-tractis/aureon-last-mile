import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useOrderConversationSessions } from './useOrderConversationSessions';

const mockFetchSessionsForOrder = vi.fn();

vi.mock('@/lib/conversations/queries', () => ({
  fetchSessionsForOrder: (...args: unknown[]) => mockFetchSessionsForOrder(...args),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useOrderConversationSessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useOrderConversationSessions(null, 'order-1'), { wrapper: createWrapper() });
    expect(mockFetchSessionsForOrder).not.toHaveBeenCalled();
  });

  it('does not fetch when orderId is null', () => {
    renderHook(() => useOrderConversationSessions('op-1', null), { wrapper: createWrapper() });
    expect(mockFetchSessionsForOrder).not.toHaveBeenCalled();
  });

  it('fetches sessions scoped to the order when both ids are present', async () => {
    const sessions = [{ id: 's-1' }];
    mockFetchSessionsForOrder.mockResolvedValue(sessions);
    const { result } = renderHook(
      () => useOrderConversationSessions('op-1', 'order-1'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sessions);
    expect(mockFetchSessionsForOrder).toHaveBeenCalledWith('op-1', 'order-1');
  });
});
