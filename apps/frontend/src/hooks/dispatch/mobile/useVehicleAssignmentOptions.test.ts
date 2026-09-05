import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/supabase/client', () => ({ createSPAClient: vi.fn() }));

import { createSPAClient } from '@/lib/supabase/client';
import { OPEN_ROUTE_STATUSES } from '@/lib/dispatch/types';
import { useVehicleAssignmentOptions } from './useVehicleAssignmentOptions';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

function buildClient(opts: {
  vehicles?: unknown[];
  vehiclesError?: unknown;
  currentRoute?: { route_date: string } | null;
  currentRouteError?: unknown;
  routes?: unknown[];
  routesError?: unknown;
}) {
  const {
    vehicles = [],
    vehiclesError = null,
    currentRoute = { route_date: '2026-09-05' },
    currentRouteError = null,
    routes = [],
    routesError = null,
  } = opts;

  const vehiclesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: vehicles, error: vehiclesError }),
  };

  // spec-79 round 8 B-1: the "routes" table now backs TWO queries — the
  // current route's own route_date (single()) and the busy-routes lookup
  // scoped by that date (in()). Same mock object services both, mirroring
  // how supabase-js chains share one builder per `.from()` call.
  const routesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: currentRoute, error: currentRouteError }),
    in: vi.fn().mockResolvedValue({ data: routes, error: routesError }),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === 'fleet_vehicles') return vehiclesChain;
    if (table === 'routes') return routesChain;
    throw new Error(`unexpected table ${table}`);
  });

  return { from: fromMock, routesChain, vehiclesChain };
}

beforeEach(() => vi.resetAllMocks());

describe('useVehicleAssignmentOptions', () => {
  it('does not query while disabled (sheet closed) — mount-gated, not just enabled:false (rule 7)', () => {
    const client = buildClient({});
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    renderHook(() => useVehicleAssignmentOptions('route-1', 'op-1', { enabled: false }), { wrapper });

    expect(client.from).not.toHaveBeenCalled();
  });

  it('shapes fleet vehicles and busy routes into picker rows', async () => {
    const client = buildClient({
      vehicles: [
        {
          id: 'v1',
          external_vehicle_id: 'RTHK-72',
          plate_number: 'RTHK-72',
          vehicle_type: 'Camión 3/4',
          driver_name: 'Mario González',
          capacity_packages: 240,
        },
        {
          id: 'v2',
          external_vehicle_id: 'ZZ-01',
          plate_number: null,
          vehicle_type: 'Furgón',
          driver_name: null,
          capacity_packages: null,
        },
      ],
      routes: [
        { id: 'other-route', vehicle_id: 'v1' },
      ],
    });
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { result } = renderHook(
      () => useVehicleAssignmentOptions('route-current', 'op-1', { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'v1', assignable: false, blockReason: 'blocked' }),
      expect.objectContaining({ id: 'v2', assignable: false, blockReason: 'no_capacity' }),
    ]);
  });

  it('D1: keeps a vehicle with no external_vehicle_id in the list instead of filtering it out', async () => {
    const client = buildClient({
      vehicles: [
        {
          id: 'v3',
          external_vehicle_id: null,
          plate_number: null,
          vehicle_type: 'Furgón',
          driver_name: null,
          capacity_packages: 100,
        },
      ],
      routes: [],
    });
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { result } = renderHook(
      () => useVehicleAssignmentOptions('route-current', 'op-1', { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'v3', externalVehicleId: null, assignable: false, blockReason: 'sin_identificador' }),
    ]);
  });

  /**
   * spec-79 round 8 B-1: the client used to filter busy routes with
   * ACTIVE_ROUTE_STATUSES (includes dispatched/in_transit/in_progress),
   * duplicating a guard the server relaxed to OPEN_ROUTE_STATUSES in round
   * 7 (H6). A dispatched morning route rendered the truck's afternoon
   * route as permanently blocked and untappable — PATCH was never even
   * reached. Pinned against the SAME imported constant the server uses
   * (not a re-declared literal array) so the two cannot drift silently
   * again: if this hook is ever changed back to ACTIVE_ROUTE_STATUSES,
   * this assertion fails even though ACTIVE_ROUTE_STATUSES is also a real,
   * importable constant.
   */
  it('B-1: filters busy routes by OPEN_ROUTE_STATUSES, the same constant the PATCH server guard uses', async () => {
    const client = buildClient({ routes: [] });
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { result } = renderHook(
      () => useVehicleAssignmentOptions('route-current', 'op-1', { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.routesChain.in).toHaveBeenCalledWith('status', OPEN_ROUTE_STATUSES);
  });

  /**
   * spec-79 round 8 B-1 (second-order): the client used to scope the busy-
   * routes lookup by todayISOInTimezone() while the server (M7, round 7)
   * scopes by the route's OWN route_date. A route dated tomorrow sharing a
   * truck with another tomorrow-dated route was invisible to the client
   * (queried today's date, found nothing, rendered assignable) even though
   * the server would correctly 409 it. Now the hook fetches the current
   * route's own route_date first and scopes the busy lookup by THAT.
   */
  it("B-1: scopes the busy-route lookup by the route's own route_date, not today", async () => {
    const client = buildClient({ currentRoute: { route_date: '2026-12-25' }, routes: [] });
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { result } = renderHook(
      () => useVehicleAssignmentOptions('route-current', 'op-1', { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.routesChain.eq).toHaveBeenCalledWith('route_date', '2026-12-25');
  });
});
