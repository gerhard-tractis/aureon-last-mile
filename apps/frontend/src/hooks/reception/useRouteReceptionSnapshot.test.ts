import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

import { useRouteReceptionSnapshot } from './useRouteReceptionSnapshot';
import {
  routeReceptionSnapshotFixture,
  routeReceptionSnapshotWithDiscrepancyFixture,
} from '@/test/fixtures/routeReceptionSnapshot';

function wrapperFactory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('useRouteReceptionSnapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fire when routeId is null', () => {
    renderHook(() => useRouteReceptionSnapshot(null), { wrapper: wrapperFactory() });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // The payload comes from the shared `satisfies RouteReceptionSnapshot`
  // fixture, not an inline literal. The old inline literal was untyped and used
  // keys `get_route_reception_snapshot` did not actually return, so this test
  // proved nothing about the real RPC. The RPC side is pinned by
  // packages/database/supabase/tests/route_reception_snapshot_contract.sql.
  it('calls get_route_reception_snapshot RPC with route id', async () => {
    mockRpc.mockResolvedValue({ data: routeReceptionSnapshotFixture, error: null });

    const { result } = renderHook(() => useRouteReceptionSnapshot('r1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_route_reception_snapshot', { p_route_id: 'r1' });
    expect(result.current.data?.route.code).toBe('PR-2026-0001');
  });

  it('exposes every key the RouteReceptionSnapshot contract declares', async () => {
    mockRpc.mockResolvedValue({ data: routeReceptionSnapshotFixture, error: null });

    const { result } = renderHook(() => useRouteReceptionSnapshot('r1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.keys(result.current.data!).sort()).toEqual([
      'discrepancies',
      'expected_packages',
      'manifests',
      'route',
      'route_reception',
      'scans',
    ]);
  });

  // spec-52: `pickup_routes.vehicle_label` is no longer the source of truth —
  // routes carry `vehicle_id` and the plate lives on `vehicles.plate`. The RPC
  // joins it in (migration 20260813000002); the interface must expose `plate`
  // and must NOT keep steering consumers at the deprecated mirror column.
  it('exposes the vehicle plate on the route header, not the legacy vehicle_label', async () => {
    mockRpc.mockResolvedValue({ data: routeReceptionSnapshotFixture, error: null });

    const { result } = renderHook(() => useRouteReceptionSnapshot('r1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.route.plate).toBe('AAA-111');
    // NOT asserting `route` lacks vehicle_label: the RPC builds that node from
    // to_jsonb(pr.*), so it genuinely still emits the column during the expand
    // phase. The old assertion passed only because this fixture omits it — the
    // test agreeing with itself rather than with production. What matters is
    // that no read site consumes it; that is pinned in useIncomingRoutes.test.ts,
    // which asserts the select string contains `vehicle:vehicles(plate)` and
    // does not contain `vehicle_label`.
  });

  // spec-52: over-count is a normal outcome, so the batch carries how many of
  // received_count arrived with no verified pickup scan on this route. It
  // reaches the client for free through `to_jsonb(rr.*)`.
  it('exposes unexpected_count on route_reception', async () => {
    mockRpc.mockResolvedValue({ data: routeReceptionSnapshotFixture, error: null });

    const { result } = renderHook(() => useRouteReceptionSnapshot('r1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.route_reception.unexpected_count).toBe(0);
  });

  it('passes discrepancies through as an array', async () => {
    mockRpc.mockResolvedValue({
      data: routeReceptionSnapshotWithDiscrepancyFixture,
      error: null,
    });

    const { result } = renderHook(() => useRouteReceptionSnapshot('r1'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.discrepancies).toEqual([
      { barcode: 'BOGUS-404', scanned_at: '2026-06-25T10:01:00Z' },
    ]);
  });

  it('surfaces RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const { result } = renderHook(() => useRouteReceptionSnapshot('rX'), {
      wrapper: wrapperFactory(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/not found/);
  });
});
