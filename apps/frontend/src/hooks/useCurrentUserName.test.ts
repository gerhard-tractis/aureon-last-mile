import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

let authUser: { id: string; email: string | null } | null = {
  id: 'user-1',
  email: 'marcela@example.com',
};
let usersRow: { full_name: string | null } | null = { full_name: 'Marcela R.' };

const mockGetUser = vi.fn(() => Promise.resolve({ data: { user: authUser } }));

function buildUsersChain() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: usersRow, error: null }));
  return chain;
}

const mockFrom = vi.fn(() => buildUsersChain());

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

import { useCurrentUserName } from './useCurrentUserName';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useCurrentUserName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: 'user-1', email: 'marcela@example.com' };
    usersRow = { full_name: 'Marcela R.' };
    mockGetUser.mockImplementation(() => Promise.resolve({ data: { user: authUser } }));
    mockFrom.mockImplementation(() => buildUsersChain());
  });

  it('returns the real name from public.users for the signed-in user', async () => {
    const { result } = renderHook(() => useCurrentUserName(), { wrapper: wrapperFactory() });
    await waitFor(() => expect(result.current.data).toBe('Marcela R.'));
    expect(mockFrom).toHaveBeenCalledWith('users');
  });

  it('falls back to the auth email when public.users has no full_name', async () => {
    usersRow = { full_name: null };
    const { result } = renderHook(() => useCurrentUserName(), { wrapper: wrapperFactory() });
    await waitFor(() => expect(result.current.data).toBe('marcela@example.com'));
  });

  it('never fabricates a name — returns null when there is no signed-in user', async () => {
    authUser = null;
    const { result } = renderHook(() => useCurrentUserName(), { wrapper: wrapperFactory() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
