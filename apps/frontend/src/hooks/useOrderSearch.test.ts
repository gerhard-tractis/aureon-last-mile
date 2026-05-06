import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useOrderSearch } from './useOrderSearch';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const ORDER_ROW = { id: 'o-1', order_number: 'ORD-001', customer_name: 'Ana', leading_status: 'en_bodega' };
const PKG_ROW = { id: 'p-1', label: 'PKG-001', status: 'en_bodega', order_id: 'o-1', orders: { order_number: 'ORD-001' } };

function setupMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'orders') return {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [ORDER_ROW], error: null }),
    };
    if (table === 'packages') return {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [PKG_ROW], error: null }),
    };
    return {};
  });
}

describe('useOrderSearch', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it('is idle when query is shorter than 2 chars', () => {
    const { result } = renderHook(() => useOrderSearch('a'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when query is empty', () => {
    const { result } = renderHook(() => useOrderSearch(''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns orders and packages for query >= 2 chars', async () => {
    setupMocks();
    const { result } = renderHook(() => useOrderSearch('ORD'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.orders).toHaveLength(1);
    expect(result.current.data?.orders[0].order_number).toBe('ORD-001');
    expect(result.current.data?.packages).toHaveLength(1);
    expect(result.current.data?.packages[0].label).toBe('PKG-001');
    expect(result.current.data?.packages[0].order_id).toBe('o-1');
  });

  it('queries both orders and packages tables', async () => {
    setupMocks();
    const { result } = renderHook(() => useOrderSearch('ORD'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(mockFrom).toHaveBeenCalledWith('packages');
  });

  it('returns empty arrays when no results', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }));
    const { result } = renderHook(() => useOrderSearch('XYZ'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.orders).toHaveLength(0);
    expect(result.current.data?.packages).toHaveLength(0);
  });
});
