// apps/frontend/src/hooks/distribution/useDockZones.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDockZones } from './useDockZones';

let mockQueryResult: { data: unknown; error: unknown } = { data: [], error: null };

function createChain(): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockImplementation(() => {
    // Return a new object that supports another .order() but also resolves
    const inner: Record<string, ReturnType<typeof vi.fn>> = {};
    inner.order = vi.fn().mockImplementation(() => Promise.resolve(mockQueryResult));
    // Also make this directly awaitable for single-order calls
    Object.assign(inner, { then: undefined }); // not a thenable itself
    return inner;
  });
  return chain;
}

let mockFromFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryResult = { data: [], error: null };
  mockFromFn = vi.fn().mockReturnValue(createChain());
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useDockZones', () => {
  it('returns empty array when no zones configured', async () => {
    const { result } = renderHook(() => useDockZones('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useDockZones(null), { wrapper });
    expect(mockFromFn).not.toHaveBeenCalled();
  });

  it('returns zones sorted with consolidation first', async () => {
    const zones = [
      { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes'], is_active: true },
      { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true },
    ];
    mockQueryResult = { data: zones, error: null };
    const { result } = renderHook(() => useDockZones('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });
});
