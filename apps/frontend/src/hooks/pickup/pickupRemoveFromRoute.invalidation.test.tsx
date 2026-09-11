import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * spec-94 fase 3 — proves the invalidation cascade the removal button
 * depends on, rather than reading it off `useRemoveManifestFromRoute`'s
 * source and trusting the prefix match: `useRemoveManifestFromRoute`
 * invalidates the `['pickup','manifests']` PREFIX, and both
 * `useRoutedManifests` (`['pickup','manifests','routed',operatorId]`) and
 * `usePendingManifests` (`['pickup','manifests','pending',operatorId]`)
 * sit under it. Neither of those two hooks is edited by fase 3 — this test
 * exists to prove the cross-hook contract fase 3's UI leans on, not to
 * cover new code.
 *
 * The full cycle the task asks for: after removal, the routed row
 * disappears from cubo 2 AND the same carga reappears in "Por retirar"
 * (cubo 1) — the two-query round trip a real QA click would exercise.
 */
const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useRoutedManifests } from './useRoutedManifests';
import { usePendingManifests } from './useManifests';
import { useRemoveManifestFromRoute } from './useRemoveManifestFromRoute';

const ROUTED_ROW = {
  id: 'm1',
  external_load_id: 'CARGA-94-DOCK',
  retailer_name: 'Easy',
  total_orders: 5,
  total_packages: 12,
  created_at: '2026-09-10T08:00:00Z',
  pickup_point: 'Easy Vespucio',
  labels_printed_at: null,
  labels_printed_by_name: null,
  route_code: 'PR-2026-0042',
  route_started_at: '2026-09-10T10:00:00Z',
  driver_name: 'Juan Pérez',
  route_status: 'in_progress',
  closed_at: null,
  missing_count: 0,
  verified_count: 0,
  pickup_route_id: 'route-1',
};

const PENDING_ROW = {
  id: 'm1',
  external_load_id: 'CARGA-94-DOCK',
  retailer_name: 'Easy',
  order_count: 5,
  package_count: 12,
  created_at: '2026-09-10T08:00:00Z',
  pickup_point: 'Easy Vespucio',
  verified_count: 0,
  labels_printed_at: null,
  labels_printed_by_name: null,
  pickup_window_start: null,
  pickup_window_end: null,
  pickup_cutoff_time: null,
};

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('remove_manifest_from_route invalidation cascade (spec-94 fase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('after removing a routed load, useRoutedManifests loses it and usePendingManifests gains it back', async () => {
    // BEFORE removal: routed has the carga, pending does not.
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_routed_manifests') {
        return Promise.resolve({ data: [ROUTED_ROW], error: null });
      }
      if (fn === 'get_pending_manifests') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fn === 'remove_manifest_from_route') {
        return Promise.resolve({ data: { id: 'm1', status: 'pending' }, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const qc = newClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const routed = renderHook(() => useRoutedManifests('op-1'), { wrapper });
    const pending = renderHook(() => usePendingManifests('op-1'), { wrapper });
    const remove = renderHook(() => useRemoveManifestFromRoute('op-1'), { wrapper });

    await waitFor(() => expect(routed.result.current.data).toHaveLength(1));
    await waitFor(() => expect(pending.result.current.data).toHaveLength(0));

    // AFTER removal: routed empties out, pending gets the carga back.
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_routed_manifests') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fn === 'get_pending_manifests') {
        return Promise.resolve({ data: [PENDING_ROW], error: null });
      }
      if (fn === 'remove_manifest_from_route') {
        return Promise.resolve({ data: { id: 'm1', status: 'pending' }, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    remove.result.current.mutate({ routeId: 'route-1', manifestId: 'm1' });
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));

    await waitFor(() => expect(routed.result.current.data).toHaveLength(0));
    await waitFor(() => expect(pending.result.current.data).toHaveLength(1));
    expect(pending.result.current.data?.[0].external_load_id).toBe('CARGA-94-DOCK');
  });
});
