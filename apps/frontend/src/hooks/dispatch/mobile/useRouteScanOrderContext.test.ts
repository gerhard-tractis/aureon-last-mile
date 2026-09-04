import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouteScanOrderContext } from './useRouteScanOrderContext';

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

function buildClient(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe('useRouteScanOrderContext', () => {
  it('maps each order to its comuna, client (retailer) name and stop index', async () => {
    buildClient([
      { order_id: 'o1', orders: { comuna: 'Ñuñoa', retailer_name: 'Falabella', delivery_address: 'Calle 1' } },
      { order_id: 'o2', orders: { comuna: 'Providencia', retailer_name: 'Ripley', delivery_address: 'Calle 2' } },
    ]);
    const { result } = renderHook(() => useRouteScanOrderContext('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.get('o1')).toEqual({ comuna: 'Ñuñoa', retailerName: 'Falabella', stopIndex: 1 });
    expect(result.current.data?.get('o2')).toEqual({ comuna: 'Providencia', retailerName: 'Ripley', stopIndex: 2 });
  });

  it('does not fetch when disabled', () => {
    buildClient([]);
    renderHook(() => useRouteScanOrderContext('r1', 'op-1', { enabled: false }), { wrapper: wrapper() });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
