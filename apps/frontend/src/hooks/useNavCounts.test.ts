import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockCallRpc = vi.fn();
vi.mock('@/lib/supabase/rpc', () => ({
  callRpc: (...args: unknown[]) => mockCallRpc(...args),
}));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({}),
}));

import { useNavCounts, navCountTone } from './useNavCounts';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  }
  return QueryWrapper;
}

beforeEach(() => {
  mockCallRpc.mockReset();
});

describe('useNavCounts', () => {
  it('returns null counts while loading so badges do not flash a false zero', () => {
    mockCallRpc.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useNavCounts('op-1'), { wrapper: wrapper() });
    expect(result.current).toEqual({
      pickup: null,
      reception: null,
      distribution: null,
      dispatch: null,
      orders: null,
    });
  });

  it('reads the one row get_nav_counts returns', async () => {
    mockCallRpc.mockResolvedValue({
      data: [{ pickup: 12, reception: 4, distribution: 318, dispatch: 27, orders: 47 }],
      error: null,
    });
    const { result } = renderHook(() => useNavCounts('op-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.distribution).toBe(318));
    expect(result.current).toEqual({
      pickup: 12,
      reception: 4,
      distribution: 318,
      dispatch: 27,
      orders: 47,
    });
  });

  it('passes the operator through — these counts are per tenant', async () => {
    mockCallRpc.mockResolvedValue({
      data: [{ pickup: 0, reception: 0, distribution: 0, dispatch: 0, orders: 0 }],
      error: null,
    });
    const { result } = renderHook(() => useNavCounts('op-9'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pickup).toBe(0));
    expect(mockCallRpc).toHaveBeenCalledWith({}, 'get_nav_counts', { p_operator_id: 'op-9' });
  });

  it('reports a genuine zero rather than hiding the badge', async () => {
    mockCallRpc.mockResolvedValue({
      data: [{ pickup: 0, reception: 3, distribution: 0, dispatch: 0, orders: 0 }],
      error: null,
    });
    const { result } = renderHook(() => useNavCounts('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.reception).toBe(3));
    expect(result.current.pickup).toBe(0);
  });

  it('stays in the loading shape when the RPC returns no rows', async () => {
    // An empty set means we know nothing, not that every queue is empty.
    mockCallRpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useNavCounts('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(mockCallRpc).toHaveBeenCalled());
    expect(result.current.pickup).toBeNull();
  });

  it('does not query without an operator', () => {
    renderHook(() => useNavCounts(null), { wrapper: wrapper() });
    expect(mockCallRpc).not.toHaveBeenCalled();
  });
});

describe('navCountTone', () => {
  it('is neutral below the module threshold and warning at or above it', () => {
    expect(navCountTone('distribution', 249)).toBe('neutral');
    expect(navCountTone('distribution', 250)).toBe('warning');
    expect(navCountTone('pickup', 50)).toBe('warning');
    expect(navCountTone('pickup', 49)).toBe('neutral');
    // The mock shows 47 orders in a warning state — threshold is 40.
    expect(navCountTone('orders', 47)).toBe('warning');
    expect(navCountTone('orders', 39)).toBe('neutral');
  });

  it('is neutral when the count is unknown', () => {
    expect(navCountTone('pickup', null)).toBe('neutral');
  });
});
