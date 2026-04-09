import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationMessages } from './useConversationMessages';

const mockFetchMessages = vi.fn();

vi.mock('@/lib/conversations/queries', () => ({
  fetchMessages: (...args: unknown[]) => mockFetchMessages(...args),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useConversationMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch when sessionId is null', () => {
    renderHook(() => useConversationMessages(null), { wrapper: createWrapper() });
    expect(mockFetchMessages).not.toHaveBeenCalled();
  });

  it('fetches messages ordered by created_at', async () => {
    const msgs = [
      { id: 'm1', role: 'system', body: 'Hola', created_at: '2026-04-09T12:00:00Z' },
      { id: 'm2', role: 'user', body: 'Gracias', created_at: '2026-04-09T12:01:00Z' },
    ];
    mockFetchMessages.mockResolvedValue(msgs);
    const { result } = renderHook(
      () => useConversationMessages('sess-1'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(msgs);
  });
});
