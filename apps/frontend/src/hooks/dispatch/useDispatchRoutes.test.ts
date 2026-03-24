import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDispatchRoutes } from './useDispatchRoutes';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

describe('useDispatchRoutes', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useDispatchRoutes(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns routes on success', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [{ id: 'r1', status: 'draft', planned_stops: 5 }], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useDispatchRoutes('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].status).toBe('draft');
  });
});
