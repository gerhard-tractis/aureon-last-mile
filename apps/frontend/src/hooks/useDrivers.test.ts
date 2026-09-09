import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDrivers, useLinkDriverUser } from './useDrivers';
import { linkDriverUser } from '@/lib/api/drivers';

vi.mock('@/lib/api/drivers', () => ({
  getDrivers: vi.fn().mockResolvedValue([]),
  linkDriverUser: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useDrivers', () => {
  it('queries under the drivers key', async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useDrivers(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = queryClient.getQueryCache().getAll();
    expect(queries.some((q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'admin-drivers')).toBe(true);
    queryClient.clear();
  });
});

describe('useLinkDriverUser', () => {
  it('invalidates the drivers cache on success', async () => {
    vi.mocked(linkDriverUser).mockResolvedValue({ id: 'd1', user_id: 'u2' });
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useLinkDriverUser(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ driverId: 'd1', userId: 'u2' });
    });

    expect(linkDriverUser).toHaveBeenCalledWith('d1', 'u2');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-drivers'] });
  });
});
