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
});
