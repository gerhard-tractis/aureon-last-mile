import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useManifestOrders } from './useManifestOrders';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe('useManifestOrders', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useManifestOrders('LOAD-1', null), { wrapper: createWrapper() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fetch when loadId is null', () => {
    renderHook(() => useManifestOrders(null, 'op-1'), { wrapper: createWrapper() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fetches orders with embedded packages', async () => {
    const mockData = [
      {
        id: 'order-1',
        order_number: 'ORD-001',
        customer_name: 'Juan Perez',
        comuna: 'Providencia',
        delivery_address: 'Av. Providencia 123',
        packages: [
          { id: 'pkg-1', label: 'CTN001', package_number: '1 of 2', sku_items: [{ sku: 'SKU1', description: 'Widget', quantity: 1 }], declared_weight_kg: 1.5, deleted_at: null },
          { id: 'pkg-2', label: 'CTN002', package_number: '2 of 2', sku_items: [], declared_weight_kg: null, deleted_at: null },
        ],
      },
    ];
    mockFrom.mockReturnValue(mockChain(mockData));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].packages).toHaveLength(2);
    expect(mockFrom).toHaveBeenCalledWith('orders');
  });

  it('filters out soft-deleted packages', async () => {
    const mockData = [
      {
        id: 'order-1',
        order_number: 'ORD-001',
        customer_name: 'Juan Perez',
        comuna: 'Providencia',
        delivery_address: 'Av. Providencia 123',
        packages: [
          { id: 'pkg-1', label: 'CTN001', package_number: null, sku_items: [], declared_weight_kg: null, deleted_at: null },
          { id: 'pkg-2', label: 'CTN002', package_number: null, sku_items: [], declared_weight_kg: null, deleted_at: '2026-03-15T00:00:00Z' },
        ],
      },
    ];
    mockFrom.mockReturnValue(mockChain(mockData));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].packages).toHaveLength(1);
    expect(result.current.data![0].packages[0].id).toBe('pkg-1');
  });

  it('returns empty array when no orders found', async () => {
    mockFrom.mockReturnValue(mockChain([]));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('handles errors', async () => {
    mockFrom.mockReturnValue(mockChain(null, { message: 'fail' }));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
