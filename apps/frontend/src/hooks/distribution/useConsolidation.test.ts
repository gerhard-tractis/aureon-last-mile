import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConsolidation } from './useConsolidation';

function makeChain(data: unknown[] = [], error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error });
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
    update: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
  }));
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useConsolidation', () => {
  it('returns empty array when no packages in consolidation', async () => {
    const { result } = renderHook(() => useConsolidation('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useConsolidation(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('maps package records to ConsolidationPackage shape', async () => {
    const rawPackages = [
      {
        id: 'p1',
        label: 'PKG-001',
        dock_zone_id: 'z1',
        order_id: 'o1',
        orders: { delivery_date: '2026-03-19' },
      },
    ];
    mockFromFn = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue(makeChain(rawPackages, null)),
      update: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
    }));

    const { result } = renderHook(() => useConsolidation('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]).toMatchObject({
      id: 'p1',
      label: 'PKG-001',
      dock_zone_id: 'z1',
      order_id: 'o1',
      delivery_date: '2026-03-19',
    });
  });
});
