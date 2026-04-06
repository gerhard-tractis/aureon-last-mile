import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRoutePackages } from './useRoutePackages';

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

describe('useRoutePackages', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId is null', () => {
    const { result } = renderHook(() => useRoutePackages(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useRoutePackages('route-1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when both ids are null', () => {
    const { result } = renderHook(() => useRoutePackages(null, null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns mapped RoutePackage array on success', async () => {
    const rawRow = {
      id: 'dispatch-1',
      order_id: 'order-1',
      status: 'pending',
      orders: { order_number: 'ORD-001', customer_name: 'Alice', delivery_address: '123 St', customer_phone: '+56911' },
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [rawRow], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      dispatch_id: 'dispatch-1',
      order_id: 'order-1',
      order_number: 'ORD-001',
      contact_name: 'Alice',
      contact_address: '123 St',
      contact_phone: '+56911',
      package_status: 'pending',
    });
  });

  it('handles orders as array (takes first element)', async () => {
    const rawRow = {
      id: 'dispatch-2',
      order_id: 'order-2',
      status: 'delivered',
      orders: [{ order_number: 'ORD-002', customer_name: 'Bob', delivery_address: '456 Ave', customer_phone: null }],
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [rawRow], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].order_number).toBe('ORD-002');
    expect(result.current.data?.[0].contact_phone).toBeNull();
  });

  it('returns empty array when no dispatches found', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('exposes isError on Supabase failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
