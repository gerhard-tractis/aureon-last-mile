import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useOpenBatchesByZone } from './useOpenBatchesByZone';

function makeChain(data: unknown[] = [], error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

let mockFromFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFromFn = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue(makeChain([], null)),
  }));
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useOpenBatchesByZone', () => {
  it('returns empty object when no open batches', async () => {
    const { result } = renderHook(() => useOpenBatchesByZone('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useOpenBatchesByZone(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('counts open dock_batches rows per zone, filtered to status=open', async () => {
    const rawBatches = [
      { dock_zone_id: 'zone-a' },
      { dock_zone_id: 'zone-a' },
      { dock_zone_id: 'zone-b' },
    ];
    const filters: Record<string, unknown> = {};
    function chainable(): Record<string, unknown> {
      const node: Record<string, unknown> = {};
      node.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
        filters[col] = val;
        return chainable();
      });
      node.is = vi.fn().mockImplementation(() => {
        return Promise.resolve({ data: rawBatches, error: null });
      });
      return node;
    }
    mockFromFn = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue(chainable()),
    }));

    const { result } = renderHook(() => useOpenBatchesByZone('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ 'zone-a': 2, 'zone-b': 1 });
    expect(filters.status).toBe('open');
    // Review fix — the repo's operator_id-on-every-query non-negotiable was
    // unguarded on this query: deleting `.eq('operator_id', ...)` from the
    // implementation left this suite green before this assertion existed.
    expect(filters.operator_id).toBe('op-1');
  });
});
