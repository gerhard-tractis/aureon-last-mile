import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDispatchRetryChecklist } from './useDispatchRetryChecklist';

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

describe('useDispatchRetryChecklist — item 15 data source', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle without a routeId or operatorId', () => {
    const { result } = renderHook(
      () => useDispatchRetryChecklist(null, 'op-1', true, true),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('counts stops with/without a receiver phone, scoped to operator_id and undeleted rows', async () => {
    const rows = [
      { order_id: 'o1', orders: { delivery_address: 'Calle 1', customer_phone: '+56911' } },
      { order_id: 'o2', orders: { delivery_address: 'Calle 2', customer_phone: null } },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useDispatchRetryChecklist('route-1', 'op-1', true, true),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith('dispatches');
    expect(chain.eq).toHaveBeenCalledWith('route_id', 'route-1');
    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(result.current.data?.verified.some((v) => /1 parada/i.test(v))).toBe(true);
    expect(result.current.data?.warnings).toContain('1 parada sin teléfono del receptor');
  });
});
