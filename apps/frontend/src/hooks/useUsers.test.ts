import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUsers } from './useUsers';

vi.mock('@/lib/api/users', () => ({
  getUsers: vi.fn().mockResolvedValue([]),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } }, // global default is true
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useUsers', () => {
  it('has refetchOnWindowFocus: false override (does not refetch on every tab switch)', () => {
    const { queryClient, wrapper } = createWrapper();
    renderHook(() => useUsers(), { wrapper });

    const queries = queryClient.getQueryCache().getAll();
    const usersQuery = queries.find((q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === 'users'
    );
    expect(usersQuery).toBeDefined();
    // The hook sets refetchOnWindowFocus: false explicitly
    expect(usersQuery!.options.refetchOnWindowFocus).toBe(false);
    queryClient.clear();
  });

  it('has staleTime: 300000 (5 minutes per AC11)', () => {
    const { queryClient, wrapper } = createWrapper();
    renderHook(() => useUsers(), { wrapper });

    const queries = queryClient.getQueryCache().getAll();
    const usersQuery = queries.find((q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === 'users'
    );
    expect(usersQuery!.options.staleTime).toBe(300000);
    queryClient.clear();
  });

  it('has refetchInterval: 300000', () => {
    const { queryClient, wrapper } = createWrapper();
    renderHook(() => useUsers(), { wrapper });

    const queries = queryClient.getQueryCache().getAll();
    const usersQuery = queries.find((q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === 'users'
    );
    expect(usersQuery!.options.refetchInterval).toBe(300000);
    queryClient.clear();
  });
});
