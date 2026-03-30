import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDispatchRoutesByStatus } from './useDispatchRoutesByStatus';

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

describe('useDispatchRoutesByStatus', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(
      () => useDispatchRoutesByStatus(null, ['draft', 'planned']),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when statuses array is empty', () => {
    const { result } = renderHook(
      () => useDispatchRoutesByStatus('op-1', []),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches routes with given statuses', async () => {
    const data = [
      { id: 'r1', status: 'in_progress', planned_stops: 3 },
      { id: 'r2', status: 'in_progress', planned_stops: 7 },
    ];
    const result = { data, error: null };
    const orderFinal = vi.fn().mockResolvedValue(result);
    const orderFirst = vi.fn().mockReturnValue({ order: orderFinal });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnValue({ order: orderFirst }),
    };
    mockFrom.mockReturnValue(chain);

    const { result: hookResult } = renderHook(
      () => useDispatchRoutesByStatus('op-1', ['in_progress']),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));
    expect(hookResult.current.data).toHaveLength(2);
    expect(chain.in).toHaveBeenCalledWith('status', ['in_progress']);
  });

  it('applies sinceDate filter when provided', async () => {
    const result = { data: [], error: null };
    // Chain: .is() -> .order() -> .order() -> .gte() -> await
    const gteMock = vi.fn().mockResolvedValue(result);
    const orderSecond = vi.fn().mockReturnValue({ gte: gteMock });
    const orderFirst = vi.fn().mockReturnValue({ order: orderSecond });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnValue({ order: orderFirst }),
    };
    mockFrom.mockReturnValue(chain);

    const { result: hookResult } = renderHook(
      () => useDispatchRoutesByStatus('op-1', ['completed', 'cancelled'], '2026-03-19'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));
    expect(gteMock).toHaveBeenCalledWith('route_date', '2026-03-19');
  });

  it('does not apply date filter when sinceDate is undefined', async () => {
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

    const { result: hookResult } = renderHook(
      () => useDispatchRoutesByStatus('op-1', ['draft', 'planned']),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));
    // No gte should be called anywhere in the chain
    expect(chain.eq).toHaveBeenCalledTimes(1); // only operator_id
  });
});
