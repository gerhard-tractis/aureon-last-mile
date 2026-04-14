import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSectorizedByZone } from './useSectorizedByZone';

function makeChain(data: unknown[] = [], error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockResolvedValue({ data, error });
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

describe('useSectorizedByZone', () => {
  it('returns empty object when no sectorized packages', async () => {
    const { result } = renderHook(() => useSectorizedByZone('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useSectorizedByZone(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('counts sectorized packages per zone', async () => {
    const rawPackages = [
      { dock_zone_id: 'zone-a' },
      { dock_zone_id: 'zone-a' },
      { dock_zone_id: 'zone-b' },
    ];
    mockFromFn = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue(makeChain(rawPackages, null)),
    }));

    const { result } = renderHook(() => useSectorizedByZone('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ 'zone-a': 2, 'zone-b': 1 });
  });
});
