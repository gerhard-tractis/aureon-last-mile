import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRoutePackagesByStop } from './useRoutePackagesByStop';

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

function chainResolving(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data, error }),
  };
}

function mockTables(opts: { dispatches: unknown; dispatchesError?: unknown; packages?: unknown; packagesError?: unknown }) {
  const dispatchesChain = chainResolving(opts.dispatches, opts.dispatchesError ?? null);
  const packagesChain = chainResolving(opts.packages ?? [], opts.packagesError ?? null);
  mockFrom.mockImplementation((table: string) => (table === 'packages' ? packagesChain : dispatchesChain));
  return { dispatchesChain, packagesChain };
}

describe('useRoutePackagesByStop', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId or operatorId is null', () => {
    const { result } = renderHook(() => useRoutePackagesByStop(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns empty data when the route has no dispatches, without querying packages', async () => {
    mockTables({ dispatches: [] });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ dispatches: [], packages: [] });
  });

  it('maps dispatch + order rows and fetches packages for their order_ids', async () => {
    const { packagesChain } = mockTables({
      dispatches: [
        {
          id: 'd1',
          order_id: 'o1',
          orders: { order_number: 'ORD-1', delivery_address: 'Los Aromos 442', customer_name: 'Javiera Muñoz' },
        },
      ],
      packages: [
        { id: 'p1', order_id: 'o1', label: 'CL8841881', package_number: null, status: 'en_carga', loaded_at: '2026-09-03T14:00:00Z' },
      ],
    });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.dispatches).toEqual([
      { dispatch_id: 'd1', order_id: 'o1', order_number: 'ORD-1', contact_address: 'Los Aromos 442', client_name: 'Javiera Muñoz' },
    ]);
    expect(result.current.data?.packages).toHaveLength(1);
    expect(packagesChain.in).toHaveBeenCalledWith('order_id', ['o1']);
  });

  it('handles orders() coming back as an array (PostgREST embed shape)', async () => {
    mockTables({
      dispatches: [
        { id: 'd1', order_id: 'o1', orders: [{ order_number: 'ORD-1', delivery_address: 'Calle 1', customer_name: 'X' }] },
      ],
      packages: [],
    });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dispatches[0].order_number).toBe('ORD-1');
  });

  it('propagates a dispatches query error', async () => {
    mockTables({ dispatches: null, dispatchesError: new Error('boom') });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('propagates a packages query error rather than silently returning an empty list', async () => {
    mockTables({
      dispatches: [{ id: 'd1', order_id: 'o1', orders: { order_number: 'ORD-1', delivery_address: 'X', customer_name: null } }],
      packages: null,
      packagesError: new Error('boom'),
    });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('spec-76 review I6 — keeps only loaded packages and retenido ones, dropping ambiguous mid-state rows', async () => {
    mockTables({
      dispatches: [{ id: 'd1', order_id: 'o1', orders: { order_number: 'ORD-1', delivery_address: 'X', customer_name: null } }],
      packages: [
        { id: 'p1', order_id: 'o1', label: 'LOADED', package_number: null, status: 'en_carga', loaded_at: '2026-09-03T14:00:00Z' },
        { id: 'p2', order_id: 'o1', label: 'RETENIDO', package_number: null, status: 'retenido', loaded_at: null },
        { id: 'p3', order_id: 'o1', label: 'NOT_YET_LOADED', package_number: null, status: 'sectorizado', loaded_at: null },
        { id: 'p4', order_id: 'o1', label: 'DAMAGED', package_number: null, status: 'dañado', loaded_at: null },
        { id: 'p5', order_id: 'o1', label: 'DELIVERED', package_number: null, status: 'entregado', loaded_at: null },
      ],
    });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const labels = result.current.data?.packages.map((p) => p.label).sort();
    expect(labels).toEqual(['LOADED', 'RETENIDO']);
  });

  it('spec-76 review I6 — a package loaded_at-set but whose status has since moved on is still kept', async () => {
    mockTables({
      dispatches: [{ id: 'd1', order_id: 'o1', orders: { order_number: 'ORD-1', delivery_address: 'X', customer_name: null } }],
      packages: [
        { id: 'p1', order_id: 'o1', label: 'DELIVERED_BUT_LOADED', package_number: null, status: 'entregado', loaded_at: '2026-09-03T14:00:00Z' },
      ],
    });
    const { result } = renderHook(() => useRoutePackagesByStop('r1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.packages).toHaveLength(1);
  });
});
