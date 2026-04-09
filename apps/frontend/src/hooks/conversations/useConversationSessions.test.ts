import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationSessions } from './useConversationSessions';

const mockFetchSessions = vi.fn();

vi.mock('@/lib/conversations/queries', () => ({
  fetchSessions: (...args: unknown[]) => mockFetchSessions(...args),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const FILTERS = { statuses: [], dateFrom: null, dateTo: null, search: '' };

describe('useConversationSessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useConversationSessions(null, FILTERS), { wrapper: createWrapper() });
    expect(mockFetchSessions).not.toHaveBeenCalled();
  });

  it('fetches sessions when operatorId is provided', async () => {
    const sessions = [{ id: 's1', status: 'active', updated_at: '2026-04-09T12:00:00Z' }];
    mockFetchSessions.mockResolvedValue(sessions);
    const { result } = renderHook(
      () => useConversationSessions('op-1', FILTERS),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sessions);
    expect(mockFetchSessions).toHaveBeenCalledWith('op-1', FILTERS);
  });
});
