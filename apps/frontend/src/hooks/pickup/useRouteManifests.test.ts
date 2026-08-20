import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRouteManifests } from './useRouteManifests';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/** A chain that resolves on its terminal call, recording every intermediate call. */
function chainResolving(data: unknown[], error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'is', 'in', 'order'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // `order` is the real terminal call for the manifests query (spec-54 4.6
  // fix); making it resolve directly means a query that forgets to call
  // `.order(...)` fails the test rather than silently returning data via
  // some other chained method.
  chain.order = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

/** Same shape, but resolves on `.is(...)` — the real terminal call for the
 *  `orders`/`packages` derived-count queries in `deriveTotalPackages`,
 *  which never call `.order(...)`. */
function chainResolvingIs(data: unknown[], error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'is', 'in', 'order'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.is = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe('useRouteManifests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec-54 phase 4.6 fix: ascending (oldest/first-attached first), not
  // descending. This is a work queue a driver adds to from this same screen
  // (`handleAdd`) — newest-first would put a just-added manifest at position
  // 0, promote it straight to "Siguiente manifiesto" and renumber every
  // badge, which is the exact instability the order clause exists to fix.
  it('orders manifests ascending by created_at so a newly-added manifest appends instead of renumbering the list', async () => {
    const manifestsChain = chainResolving([
      { id: 'm1', external_load_id: 'L1', retailer_name: 'A', pickup_location: 'Av. Siempre Viva 123', total_orders: 1, total_packages: 2 },
    ]);
    const scansChain = chainResolving([]);
    mockFrom.mockImplementation((table: string) =>
      table === 'manifests' ? manifestsChain : scansChain,
    );

    const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(manifestsChain.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('selects pickup_location so the driver can be shown where to go', async () => {
    const manifestsChain = chainResolving([
      { id: 'm1', external_load_id: 'L1', retailer_name: 'A', pickup_location: 'Av. Siempre Viva 123', total_orders: 1, total_packages: 2 },
    ]);
    const scansChain = chainResolving([]);
    mockFrom.mockImplementation((table: string) =>
      table === 'manifests' ? manifestsChain : scansChain,
    );

    const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(manifestsChain.select).toHaveBeenCalledWith(
      expect.stringContaining('pickup_location'),
    );
    expect(result.current.data?.[0].pickup_location).toBe('Av. Siempre Viva 123');
  });

  // spec-54 3h (mobile) — the card view sorts by real status and shows a
  // status badge, so the manifest's lifecycle state has to travel through
  // this hook rather than being guessed from verified_count.
  it('selects and passes through the manifest status', async () => {
    const manifestsChain = chainResolving([
      { id: 'm1', external_load_id: 'L1', retailer_name: 'A', pickup_location: null, total_orders: 1, total_packages: 2, status: 'in_progress' },
    ]);
    const scansChain = chainResolving([]);
    mockFrom.mockImplementation((table: string) =>
      table === 'manifests' ? manifestsChain : scansChain,
    );

    const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(manifestsChain.select).toHaveBeenCalledWith(expect.stringContaining('status'));
    expect(result.current.data?.[0].status).toBe('in_progress');
  });

  it('passes through a null pickup_location rather than fabricating one', async () => {
    const manifestsChain = chainResolving([
      { id: 'm1', external_load_id: 'L1', retailer_name: 'A', pickup_location: null, total_orders: 1, total_packages: 2 },
    ]);
    const scansChain = chainResolving([]);
    mockFrom.mockImplementation((table: string) =>
      table === 'manifests' ? manifestsChain : scansChain,
    );

    const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].pickup_location).toBeNull();
  });

  // The QA-CARGA-C bug: `manifests.total_packages` is a nullable,
  // occasionally-stale denormalisation of COUNT(real, non-deleted package
  // rows) — see `20260814000001_manifest_row_per_carga.sql` (left NULL at
  // creation) and `20260814000002_spec55_carton_expansion.sql` (the only
  // writer, and it writes exactly this COUNT). `get_pending_manifests`
  // (desktop's `1l` table) computes the very same COUNT directly and never
  // reads the column. When the column is NULL, this hook now derives the
  // same real number instead of leaving a manifest with real, ingested
  // packages honestly-but-needlessly showing "—" on mobile while desktop's
  // `PAQ.` column (same manifest, same moment) shows the true count.
  describe('total_packages fallback when NULL (QA-CARGA-C)', () => {
    it('present total_packages is left unchanged — no derived-count query is made', async () => {
      const manifestsChain = chainResolving([
        { id: 'm1', external_load_id: 'L1', retailer_name: 'A', pickup_location: null, total_orders: 1, total_packages: 2 },
      ]);
      const scansChain = chainResolving([]);
      const ordersSpy = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'manifests') return manifestsChain;
        if (table === 'orders') {
          ordersSpy();
          return chainResolving([]);
        }
        return scansChain;
      });

      const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0].total_packages).toBe(2);
      expect(ordersSpy).not.toHaveBeenCalled();
    });

    it('NULL total_packages with real package rows falls back to the derived COUNT', async () => {
      const manifestsChain = chainResolving([
        { id: 'm1', external_load_id: 'QA-CARGA-C', retailer_name: 'A', pickup_location: null, total_orders: 1, total_packages: null },
      ]);
      const scansChain = chainResolving([]);
      const ordersChain = chainResolvingIs([
        { id: 'o1', external_load_id: 'QA-CARGA-C' },
      ]);
      const packagesChain = chainResolvingIs([{ order_id: 'o1' }]);
      mockFrom.mockImplementation((table: string) => {
        if (table === 'manifests') return manifestsChain;
        if (table === 'orders') return ordersChain;
        if (table === 'packages') return packagesChain;
        return scansChain;
      });

      const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0].total_packages).toBe(1);
    });

    it('NULL total_packages with zero package rows stays NULL — never fabricates a 0', async () => {
      const manifestsChain = chainResolving([
        { id: 'm1', external_load_id: 'L1', retailer_name: 'A', pickup_location: null, total_orders: 1, total_packages: null },
      ]);
      const scansChain = chainResolving([]);
      const ordersChain = chainResolvingIs([{ id: 'o1', external_load_id: 'L1' }]);
      const packagesChain = chainResolvingIs([]);
      mockFrom.mockImplementation((table: string) => {
        if (table === 'manifests') return manifestsChain;
        if (table === 'orders') return ordersChain;
        if (table === 'packages') return packagesChain;
        return scansChain;
      });

      const { result } = renderHook(() => useRouteManifests('route-1', 'op-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0].total_packages).toBeNull();
    });
  });
});
