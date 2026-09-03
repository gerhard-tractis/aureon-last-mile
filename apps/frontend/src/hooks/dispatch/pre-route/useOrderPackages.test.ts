import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOrderPackages } from './useOrderPackages';

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

function packagesChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: { data: unknown[]; error: unknown }) => void) => resolve({ data, error }),
  };
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  return chain;
}

const MOCK_ROWS = [
  {
    id: 'pkg-1',
    label: 'PKG-001',
    status: 'en_bodega',
    sku_items: [{ sku: 'SKU-A', description: 'Silla', quantity: 2 }],
  },
  {
    id: 'pkg-2',
    label: 'PKG-002',
    status: 'retenido',
    sku_items: [{ sku: 'SKU-B', description: 'Mesa', quantity: 1 }],
  },
];

describe('useOrderPackages', () => {
  beforeEach(() => mockFrom.mockReset());

  it('stays idle with no orderId', () => {
    mockFrom.mockImplementation(() => packagesChain([]));
    const { result } = renderHook(() => useOrderPackages(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays idle with no operatorId', () => {
    mockFrom.mockImplementation(() => packagesChain([]));
    const { result } = renderHook(() => useOrderPackages('order-1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches and normalises packages once both ids are present', async () => {
    mockFrom.mockImplementation(() => packagesChain(MOCK_ROWS));

    const { result } = renderHook(() => useOrderPackages('order-1', 'op-1'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith('packages');
    expect(result.current.data).toEqual([
      {
        id: 'pkg-1',
        label: 'PKG-001',
        isHeld: false,
        skuItems: [{ sku: 'SKU-A', description: 'Silla', quantity: 2 }],
      },
      {
        id: 'pkg-2',
        label: 'PKG-002',
        isHeld: true,
        skuItems: [{ sku: 'SKU-B', description: 'Mesa', quantity: 1 }],
      },
    ]);
  });

  it('scopes the query by order_id, operator_id and deleted_at', async () => {
    const chain = packagesChain(MOCK_ROWS);
    mockFrom.mockImplementation(() => chain);

    const { result } = renderHook(() => useOrderPackages('order-1', 'op-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(chain.eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('tolerates missing or malformed sku_items', async () => {
    mockFrom.mockImplementation(() =>
      packagesChain([{ id: 'pkg-3', label: 'PKG-003', status: 'en_bodega', sku_items: null }]),
    );

    const { result } = renderHook(() => useOrderPackages('order-1', 'op-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].skuItems).toEqual([]);
  });
});
