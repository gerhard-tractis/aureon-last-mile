import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
const routeResult = { data: null as unknown, error: null as unknown };
const scansResult = { data: [] as unknown[], error: null as unknown };

function chain(final: () => unknown) {
  const proxy: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'is', 'in', 'order', 'neq']) {
    proxy[key] = vi.fn(() => proxy);
  }
  proxy.maybeSingle = vi.fn(async () => final());
  proxy.then = (resolve: (v: unknown) => unknown) => Promise.resolve(final()).then(resolve);
  return proxy;
}

const mockFrom = vi.fn((table: string) => {
  if (table === 'pickup_routes') return chain(() => routeResult);
  return chain(() => scansResult);
});

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

import { useRoutePreview } from './useRoutePreview';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useRoutePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeResult.data = null;
    routeResult.error = null;
    scansResult.data = [];
    scansResult.error = null;
  });

  it('does not fire without a routeId or operatorId', () => {
    renderHook(() => useRoutePreview(null, 'op-1'), { wrapper: wrapperFactory() });
    renderHook(() => useRoutePreview('r1', null), { wrapper: wrapperFactory() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('maps route header, plate, cargas and distinct scanned packages', async () => {
    routeResult.data = {
      id: 'r1',
      code: 'PR-2026-0001',
      status: 'in_progress',
      started_at: '2026-06-25T06:00:00Z',
      driver: { full_name: 'Ana Ruiz' },
      vehicle: { plate: 'AAA-111' },
      manifests: [{ id: 'm1' }, { id: 'm2' }],
    };
    scansResult.data = [
      { manifest_id: 'm1', package_id: 'p1' },
      { manifest_id: 'm1', package_id: 'p1' },
      { manifest_id: 'm2', package_id: 'p2' },
    ];

    const { result } = renderHook(() => useRoutePreview('r1', 'op-1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      id: 'r1',
      code: 'PR-2026-0001',
      status: 'in_progress',
      started_at: '2026-06-25T06:00:00Z',
      driver_name: 'Ana Ruiz',
      vehicle_plate: 'AAA-111',
      manifest_count: 2,
      scanned_count: 2,
    });
  });

  it('never calls open_route_reception', async () => {
    routeResult.data = {
      id: 'r1', code: 'PR-2026-0001', status: 'in_progress', started_at: null,
      driver: null, vehicle: null, manifests: [],
    };

    const { result } = renderHook(() => useRoutePreview('r1', 'op-1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.data?.scanned_count).toBe(0);
  });

  it('returns null when the route is not found', async () => {
    routeResult.data = null;

    const { result } = renderHook(() => useRoutePreview('r1', 'op-1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
