import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockCallRpc = vi.fn();
vi.mock('@/lib/supabase/rpc', () => ({
  callRpc: (...args: unknown[]) => mockCallRpc(...args),
}));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({}),
}));

import { useOrdersList, EMPTY_ORDERS_LIST_FILTERS, type OrdersListFilters } from './useOrdersList';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  }
  return QueryWrapper;
}

beforeEach(() => {
  mockCallRpc.mockReset();
});

const ROW = {
  id: 'ord-1',
  order_number: 'PED-001',
  customer_name: 'Jane Doe',
  leading_status: 'in_transit',
  comuna: 'Providencia',
  package_count: 3,
  route_label: 'R-42',
  driver_name: 'Carlos',
  sla_status: 'at_risk',
  minutes_remaining: 30,
  last_event_at: '2026-08-22T10:00:00Z',
  last_event_label: 'Salió a reparto',
  has_pod: false,
  total_count: 123,
};

describe('useOrdersList', () => {
  it('does not query without an operator', () => {
    renderHook(() => useOrdersList(null, EMPTY_ORDERS_LIST_FILTERS, 0), { wrapper: wrapper() });
    expect(mockCallRpc).not.toHaveBeenCalled();
  });

  it('passes every filter to get_orders_list at its correct, named position', async () => {
    mockCallRpc.mockResolvedValue({ data: [ROW], error: null });

    const filters: OrdersListFilters = {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      statuses: ['in_transit'],
      sla: ['late', 'at_risk'],
      routeIds: ['route-1'],
      driver: 'Carlos',
      client: 'Falabella',
      comunas: ['Providencia'],
      hasPod: false,
      minAttempts: 2,
      search: 'PED-001',
    };

    const { result } = renderHook(() => useOrdersList('op-1', filters, 0), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(mockCallRpc).toHaveBeenCalledWith({}, 'get_orders_list', {
      p_operator_id: 'op-1',
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
      p_statuses: ['in_transit'],
      p_sla: ['late', 'at_risk'],
      p_route_ids: ['route-1'],
      p_driver: 'Carlos',
      p_client: 'Falabella',
      p_comunas: ['Providencia'],
      p_has_pod: false,
      p_min_attempts: 2,
      p_search: 'PED-001',
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('passes NULL for every unset filter — NULL means "no filter" in the RPC', async () => {
    mockCallRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useOrdersList('op-1', EMPTY_ORDERS_LIST_FILTERS, 0), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(mockCallRpc).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockCallRpc).toHaveBeenCalledWith({}, 'get_orders_list', {
      p_operator_id: 'op-1',
      p_date_from: null,
      p_date_to: null,
      p_statuses: null,
      p_sla: null,
      p_route_ids: null,
      p_driver: null,
      p_client: null,
      p_comunas: null,
      p_has_pod: null,
      p_min_attempts: null,
      p_search: null,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('pages via p_offset — page 2 shifts the offset by the page size, not the limit', async () => {
    mockCallRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useOrdersList('op-1', EMPTY_ORDERS_LIST_FILTERS, 2), { wrapper: wrapper() });

    await waitFor(() => expect(mockCallRpc).toHaveBeenCalled());
    const args = mockCallRpc.mock.calls[0][2];
    expect(args.p_limit).toBe(50);
    expect(args.p_offset).toBe(100);
  });

  it('returns rows and surfaces total_count separately from the row list', async () => {
    mockCallRpc.mockResolvedValue({ data: [ROW, { ...ROW, id: 'ord-2' }], error: null });

    const { result } = renderHook(() => useOrdersList('op-1', EMPTY_ORDERS_LIST_FILTERS, 0), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.rows).toHaveLength(2);
    expect(result.current.data?.totalCount).toBe(123);
  });

  it('reports zero total when the RPC returns no rows', async () => {
    mockCallRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useOrdersList('op-1', EMPTY_ORDERS_LIST_FILTERS, 0), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows).toEqual([]);
    expect(result.current.data?.totalCount).toBe(0);
  });

  it('changes the query key on any filter change so a new page is not served stale', async () => {
    mockCallRpc.mockResolvedValue({ data: [], error: null });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const Wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { rerender } = renderHook(
      ({ filters, page }: { filters: OrdersListFilters; page: number }) =>
        useOrdersList('op-1', filters, page),
      {
        wrapper: Wrapper,
        initialProps: { filters: EMPTY_ORDERS_LIST_FILTERS, page: 0 },
      },
    );

    await waitFor(() => expect(mockCallRpc).toHaveBeenCalledTimes(1));

    rerender({ filters: { ...EMPTY_ORDERS_LIST_FILTERS, driver: 'Carlos' }, page: 0 });
    await waitFor(() => expect(mockCallRpc).toHaveBeenCalledTimes(2));

    rerender({ filters: { ...EMPTY_ORDERS_LIST_FILTERS, driver: 'Carlos' }, page: 1 });
    await waitFor(() => expect(mockCallRpc).toHaveBeenCalledTimes(3));
  });

  it('surfaces the RPC error', async () => {
    mockCallRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => useOrdersList('op-1', EMPTY_ORDERS_LIST_FILTERS, 0), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
