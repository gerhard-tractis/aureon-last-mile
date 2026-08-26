import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDispatchRoute, dispatchRouteKey } from './useDispatchRoute';
import { useRefreshRouteStatus } from './useRefreshRouteStatus';

/**
 * The regression this file exists for.
 *
 * Phase 4 made every affordance in the route builder derive from the route's
 * persisted status — correct — but the cached copy had no writer. The key was
 * written inline inside `useDispatchRoute` and nowhere else, so nothing
 * invalidated it: `/seal` returned 200, the row moved to `loaded`, and the UI
 * went on rendering `loading` with "Cerrar ruta" still enabled and "Despachar"
 * still disabled. Tapping again just returned `already_sealed`.
 *
 * A test that mocks `useDispatchRoute` cannot catch that, because the bug is
 * *between* the query and its invalidator. So this mounts the real hook
 * against a real QueryClient and asserts the two agree on the key.
 */

const ROUTE = {
  id: 'route-1',
  operator_id: 'op-1',
  status: 'loading',
  route_date: '2026-08-26',
  driver_name: null,
  vehicle_id: null,
  external_route_id: 'draft_x',
  planned_stops: 2,
  completed_stops: 0,
  created_at: '2026-08-26T00:00:00Z',
};

const single = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn(self);
      chain.eq = vi.fn(self);
      chain.is = vi.fn(self);
      chain.single = single;
      return chain;
    },
  }),
}));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  single.mockResolvedValue({ data: ROUTE, error: null });
});

describe('useDispatchRoute / useRefreshRouteStatus — cache key alignment', () => {
  it('registers the query under exactly the key the refresher invalidates', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDispatchRoute('route-1', 'op-1'), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    // The bug was that these two were different keys. Asserting the query is
    // findable under the exported factory's key is what proves an
    // invalidation will actually reach it.
    const found = client.getQueryCache().find({ queryKey: dispatchRouteKey('route-1', 'op-1') });
    expect(found).toBeDefined();
    expect(found?.state.data).toMatchObject({ status: 'loading' });
  });

  it('re-reads the route when the refresher runs, so a seal becomes visible', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = wrapper(client);

    const query = renderHook(() => useDispatchRoute('route-1', 'op-1'), { wrapper: w });
    await waitFor(() => expect(query.result.current.data?.status).toBe('loading'));

    // The route is sealed server-side while the UI holds the old copy.
    single.mockResolvedValue({ data: { ...ROUTE, status: 'loaded' }, error: null });

    const refresh = renderHook(() => useRefreshRouteStatus('route-1', 'op-1'), { wrapper: w });
    await act(async () => { await refresh.result.current(); });

    await waitFor(() => expect(query.result.current.data?.status).toBe('loaded'));
  });

  /**
   * A route cached for one operator must not be served to another. The key
   * carries operatorId for the same reason useDispatchRoutes' does.
   */
  it('does not share a cache entry across operators', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(dispatchRouteKey('route-1', 'op-1')).not.toEqual(dispatchRouteKey('route-1', 'op-2'));

    renderHook(() => useDispatchRoute('route-1', 'op-1'), { wrapper: wrapper(client) });
    await waitFor(() =>
      expect(client.getQueryCache().find({ queryKey: dispatchRouteKey('route-1', 'op-1') })).toBeDefined(),
    );
    expect(client.getQueryCache().find({ queryKey: dispatchRouteKey('route-1', 'op-2') })).toBeUndefined();
  });
});
