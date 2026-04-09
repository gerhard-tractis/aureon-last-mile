import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSendReply } from './useSendReply';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useSendReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls POST /api/conversations/reply with correct payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message_id: 'm1', created_at: '2026-04-09T12:00:00Z' }),
    });
    const { result } = renderHook(() => useSendReply(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ session_id: 's1', body: 'Hola' });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', body: 'Hola' }),
    });
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Session is not escalated' }),
    });
    const { result } = renderHook(() => useSendReply(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ session_id: 's1', body: 'Hola' });
      }),
    ).rejects.toThrow();
  });
});
