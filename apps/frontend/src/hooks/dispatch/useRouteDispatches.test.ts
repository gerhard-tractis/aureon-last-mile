import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouteDispatches } from './useRouteDispatches';

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

describe('useRouteDispatches', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId is null', () => {
    const { result } = renderHook(
      () => useRouteDispatches(null, 'op-1'),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(
      () => useRouteDispatches('route-1', null),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns mapped RouteDispatchSummary[] on success', async () => {
    const rawRow = {
      id: 'dp-1',
      order_id: 'ord-1',
      status: 'delivered',
      orders: { order_number: 'ORD-001', customer_name: 'Alice', delivery_address: '123 St', customer_phone: '+56911' },
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [rawRow], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      dispatch_id: 'dp-1',
      order_id: 'ord-1',
      order_number: 'ORD-001',
      contact_name: 'Alice',
      contact_address: '123 St',
      contact_phone: '+56911',
      status: 'delivered',
    });
  });

  it('handles orders as array (takes first element)', async () => {
    const rawRow = {
      id: 'dp-2',
      order_id: 'ord-2',
      status: 'failed',
      orders: [{ order_number: 'ORD-002', customer_name: 'Bob', delivery_address: '456 Ave', customer_phone: null }],
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [rawRow], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].order_number).toBe('ORD-002');
    expect(result.current.data?.[0].contact_phone).toBeNull();
    expect(result.current.data?.[0].status).toBe('failed');
  });

  it('sorts by status bucket (failed → pending/partial → delivered) then order_number', async () => {
    const rows = [
      { id: 'd1', order_id: 'o1', status: 'delivered', orders: { order_number: 'ORD-A', customer_name: null, delivery_address: null, customer_phone: null } },
      { id: 'd2', order_id: 'o2', status: 'failed',    orders: { order_number: 'ORD-B', customer_name: null, delivery_address: null, customer_phone: null } },
      { id: 'd3', order_id: 'o3', status: 'pending',   orders: { order_number: 'ORD-C', customer_name: null, delivery_address: null, customer_phone: null } },
      { id: 'd4', order_id: 'o4', status: 'partial',   orders: { order_number: 'ORD-D', customer_name: null, delivery_address: null, customer_phone: null } },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((d) => d.order_number)).toEqual(['ORD-B', 'ORD-C', 'ORD-D', 'ORD-A']);
  });

  it('exposes isError and refetch on Supabase failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(typeof result.current.refetch).toBe('function');
  });

  it('returns empty array when no dispatches found', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
