import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDistributionKPIs } from './useDistributionKPIs';

// Build a chainable mock that resolves at any terminal call (.is, .lte)
function makeChain(count: number): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve({ count, error: null });
  // any method returns itself or a resolved promise depending on call context
  const fn = vi.fn().mockImplementation(() => {
    // Make the returned object both chainable and thenable (so await works)
    const next = makeResolvableChain(count);
    return next;
  });
  chain.eq = fn;
  chain.is = vi.fn().mockReturnValue(makeResolvableChain(count));
  chain.lte = vi.fn().mockReturnValue(resolved);
  void resolved;
  return chain;
}

function makeResolvableChain(count: number): Record<string, unknown> {
  // This object IS awaitable (has then) AND has further chain methods
  const inner: Record<string, unknown> = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
      Promise.resolve({ count, error: null }).then(onFulfilled, onRejected),
    eq: vi.fn().mockImplementation(() => makeResolvableChain(count)),
    is: vi.fn().mockImplementation(() => makeResolvableChain(count)),
    lte: vi.fn().mockImplementation(() => makeResolvableChain(count)),
  };
  return inner;
}

let mockFromFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFromFn = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue(makeResolvableChain(0)),
  }));
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useDistributionKPIs', () => {
  it('returns zero counts when no packages', async () => {
    const { result } = renderHook(() => useDistributionKPIs('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pending).toBe(0);
    expect(result.current.data?.consolidation).toBe(0);
    expect(result.current.data?.dueSoon).toBe(0);
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useDistributionKPIs(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('calls supabase.from("packages") for each KPI', async () => {
    const { result } = renderHook(() => useDistributionKPIs('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFromFn).toHaveBeenCalledWith('packages');
    expect(mockFromFn).toHaveBeenCalledTimes(3);
  });
});
