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

  it('returns routes on success with ordering', async () => {
    const result = { data: [{ id: 'r1', status: 'draft', planned_stops: 5 }], error: null };
    const orderFinal = vi.fn().mockResolvedValue(result);
    const orderFirst = vi.fn().mockReturnValue({ order: orderFinal });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnValue({ order: orderFirst }),
    };
    mockFrom.mockReturnValue(chain);

    const { result: hookResult } = renderHook(() => useDispatchRoutes('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));
    expect(hookResult.current.data).toHaveLength(1);
    expect(hookResult.current.data?.[0].status).toBe('draft');
  });

  it('does not filter by route_date', async () => {
    const result = { data: [], error: null };
    const orderFinal = vi.fn().mockResolvedValue(result);
    const orderFirst = vi.fn().mockReturnValue({ order: orderFinal });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnValue({ order: orderFirst }),
    };
    mockFrom.mockReturnValue(chain);

    const { result: hookResult } = renderHook(() => useDispatchRoutes('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));

    // eq should only be called once (for operator_id), not twice (no route_date)
    expect(chain.eq).toHaveBeenCalledTimes(1);
    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
  });

  it('applies order by route_date and created_at', async () => {
    const result = { data: [], error: null };
    const orderFinal = vi.fn().mockResolvedValue(result);
    const orderFirst = vi.fn().mockReturnValue({ order: orderFinal });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnValue({ order: orderFirst }),
    };
    mockFrom.mockReturnValue(chain);

    const { result: hookResult } = renderHook(() => useDispatchRoutes('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));

    expect(orderFirst).toHaveBeenCalledWith('route_date', { ascending: false });
    expect(orderFinal).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
