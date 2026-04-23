import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCreateRouteFromSelection } from './useCreateRouteFromSelection';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  // expose the client for invalidation assertions
  (Wrapper as { _qc?: QueryClient })._qc = qc;
  return Wrapper;
}

describe('useCreateRouteFromSelection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /api/dispatch/routes with order_ids in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'route-1', status: 'draft', route_date: '2026-04-23', created_at: '2026-04-23T12:00:00Z' }),
    });
    const { result } = renderHook(() => useCreateRouteFromSelection(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ orderIds: ['ord-1', 'ord-2'] });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/dispatch/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ids: ['ord-1', 'ord-2'] }),
    });
  });

  it('returns the route object on success', async () => {
    const ROUTE = { id: 'route-42', status: 'draft', route_date: '2026-04-23', created_at: '2026-04-23T12:00:00Z' };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(ROUTE) });
    const { result } = renderHook(() => useCreateRouteFromSelection(), { wrapper: createWrapper() });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({ orderIds: ['ord-1'] });
    });

    expect((returned as { id: string }).id).toBe('route-42');
  });

  it('throws a structured error on 400 ORDERS_ALREADY_ROUTED', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ code: 'ORDERS_ALREADY_ROUTED', routed_ids: ['ord-1'] }),
    });
    const { result } = renderHook(() => useCreateRouteFromSelection(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orderIds: ['ord-1'] });
      }),
    ).rejects.toMatchObject({ code: 'ORDERS_ALREADY_ROUTED', routed_ids: ['ord-1'] });
  });

  it('throws a structured error on 400 INVALID_ORDER_IDS', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ code: 'INVALID_ORDER_IDS', invalid_ids: ['ord-99'] }),
    });
    const { result } = renderHook(() => useCreateRouteFromSelection(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ orderIds: ['ord-99'] });
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_IDS', invalid_ids: ['ord-99'] });
  });

  it('invalidates dispatch pre-route and dispatch routes query keys on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'route-1', status: 'draft', route_date: '2026-04-23', created_at: '2026-04-23T12:00:00Z' }),
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const W = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => useCreateRouteFromSelection(), { wrapper: W });
    await act(async () => {
      await result.current.mutateAsync({ orderIds: ['ord-1'] });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'pre-route'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'routes'] });
  });

  it('accepts empty order_ids (empty body — regression check)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'route-empty', status: 'draft', route_date: '2026-04-23', created_at: '2026-04-23T12:00:00Z' }),
    });
    const { result } = renderHook(() => useCreateRouteFromSelection(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ orderIds: [] });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/dispatch/routes', expect.objectContaining({
      body: JSON.stringify({ order_ids: [] }),
    }));
  });
});
