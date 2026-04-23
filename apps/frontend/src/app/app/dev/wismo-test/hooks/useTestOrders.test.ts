import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTestOrders } from './useTestOrders';
import type { TestOrder } from './types';

const mockOrders: TestOrder[] = [
  {
    id: 'order-1',
    customer_name: 'Alice',
    customer_phone: '+56900000001',
    delivery_date: '2026-05-01',
    status: 'pending',
    created_at: '2026-04-23T00:00:00Z',
  },
];

function makeFetchMock(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(response),
  });
}

describe('useTestOrders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches orders on mount and loading becomes false after', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ orders: mockOrders }));

    const { result } = renderHook(() => useTestOrders());

    // loading starts true
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.orders).toEqual(mockOrders);
    expect(result.current.error).toBeNull();
  });

  it('sets error on failed fetch', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ error: 'Server error' }, false, 500));

    const { result } = renderHook(() => useTestOrders());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Server error');
    expect(result.current.orders).toEqual([]);
  });

  it('create() POSTs to /api/dev/wismo-test/test-orders and then refreshes', async () => {
    const createResponse = { order_id: 'new-order', snapshot: {} };
    const fetchMock = vi.fn();

    // First call: initial mount GET
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ orders: [] }),
    });
    // Second call: POST create
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(createResponse),
    });
    // Third call: refresh after create GET
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ orders: mockOrders }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useTestOrders());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createResult: { order_id: string; snapshot: unknown } | undefined;
    await act(async () => {
      createResult = await result.current.create({
        customer_name: 'Alice',
        customer_phone: '+56900000001',
        delivery_date: '2026-05-01',
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // POST was called with correct URL and method
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/wismo-test/test-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Alice',
        customer_phone: '+56900000001',
        delivery_date: '2026-05-01',
      }),
    });

    expect(createResult).toEqual(createResponse);

    // After create, refresh was called — orders updated
    expect(result.current.orders).toEqual(mockOrders);
  });

  it('purge() POSTs to /api/dev/wismo-test/test-orders/purge and then refreshes', async () => {
    const purgeResponse = { deleted_count: 5 };
    const fetchMock = vi.fn();

    // First call: initial mount GET
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ orders: mockOrders }),
    });
    // Second call: POST purge
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(purgeResponse),
    });
    // Third call: refresh after purge GET
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ orders: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useTestOrders());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let purgeResult: { deleted_count: number } | undefined;
    await act(async () => {
      purgeResult = await result.current.purge();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // POST was called with purge URL
    expect(fetchMock).toHaveBeenCalledWith('/api/dev/wismo-test/test-orders/purge', {
      method: 'POST',
    });

    expect(purgeResult).toEqual(purgeResponse);

    // After purge, refresh was called — orders now empty
    expect(result.current.orders).toEqual([]);
  });

  it('loading is true while fetching, false after', async () => {
    let resolveFetch!: (v: unknown) => void;
    const slowPromise = new Promise((res) => {
      resolveFetch = res;
    });

    vi.stubGlobal('fetch', vi.fn().mockReturnValue(slowPromise));

    const { result } = renderHook(() => useTestOrders());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ orders: [] }) });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
