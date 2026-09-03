import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { DELETE, PATCH } from './route';
import { NextRequest } from 'next/server';

function buildRequest() {
  return new NextRequest('http://localhost/api/dispatch/routes/r1', { method: 'DELETE' });
}

const params = Promise.resolve({ id: 'r1' });

function buildClient(
  routeStatus: string | null,
  dispatches: { id: string; order_id: string }[] = [],
  routeError: { code: string; message: string } | null = null,
) {
  const routeChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      routeError
        ? { data: null, error: routeError }
        : { data: routeStatus ? { id: 'r1', status: routeStatus } : null, error: null },
    ),
  };
  const dispatchesSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: dispatches, error: null }),
  };
  const dispatchesUpdateChain = {
    update: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
  };
  // .update({status}).in('order_id', orderIds).eq('operator_id', operatorId).in('status', [...])
  const packagesStatusInSpy = vi.fn().mockResolvedValue({ error: null });
  const packagesUpdateSpy = vi.fn().mockReturnValue({
    in: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ in: packagesStatusInSpy }),
    }),
  });
  const packagesChain = { update: packagesUpdateSpy };
  const routeDeleteChain = {
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === 'routes') {
      // First call is the select (single); the second (if reached) is the delete update.
      if (fromMock.mock.calls.filter((c) => c[0] === 'routes').length <= 1) return routeChain;
      return routeDeleteChain;
    }
    if (table === 'dispatches') {
      const dispatchesCalls = fromMock.mock.calls.filter((c) => c[0] === 'dispatches').length;
      return dispatchesCalls <= 1 ? dispatchesSelectChain : dispatchesUpdateChain;
    }
    if (table === 'packages') return packagesChain;
    return routeChain;
  });

  return {
    client: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
          error: null,
        }),
      },
      from: fromMock,
    },
    packagesUpdateSpy,
    packagesStatusInSpy,
  };
}

beforeEach(() => vi.resetAllMocks());

describe('DELETE /routes/[id] — release is a one-way door (spec-70 decision 6)', () => {
  it.each(['draft', 'planned', 'loading', 'loaded'])('allows deleting a %s route', async (status) => {
    const { client } = buildClient(status);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
  });

  it.each(['dispatched', 'in_transit', 'in_progress', 'completed', 'cancelled'])(
    'refuses to delete a %s route',
    async (status) => {
      const { client } = buildClient(status);
      (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
      const res = await DELETE(buildRequest(), { params });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('ALREADY_DISPATCHED');
    },
  );

  it('resets affected packages to sectorizado, not asignado', async () => {
    const { client, packagesUpdateSpy } = buildClient('planned', [{ id: 'd1', order_id: 'o1' }]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    expect(packagesUpdateSpy).toHaveBeenCalledWith({ status: 'sectorizado' });
  });

  /**
   * Review fix: /seal has already moved a staged package from en_carga to
   * listo_para_despacho by the time a `loaded` route reaches here.
   * OPEN_ROUTE_STATUSES admits `loaded`, so filtering the reset on en_carga
   * alone matched nothing for a sealed-then-deleted route — its packages
   * were stranded at listo_para_despacho with no route at all.
   */
  it('resets a sealed route\'s packages too (listo_para_despacho, not just en_carga)', async () => {
    const { client, packagesStatusInSpy } = buildClient('loaded', [{ id: 'd1', order_id: 'o1' }]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    expect(packagesStatusInSpy).toHaveBeenCalledWith('status', ['en_carga', 'listo_para_despacho']);
  });

  it('404s for another operator\'s route', async () => {
    const { client } = buildClient(null);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(404);
  });

  it('reports a failed route lookup as QUERY_FAILED, not 404', async () => {
    const { client } = buildClient(null, [], { code: '08006', message: 'connection reset' });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
  });

  it('treats PGRST116 (no row matched) as a genuine 404, not QUERY_FAILED', async () => {
    const { client } = buildClient(null, [], { code: 'PGRST116', message: 'no rows' });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(404);
  });

  it('401s without a session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    });
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH — spec-76 task 2 (2d). Assigns fleet_vehicles + driver_name onto a
// route BEFORE dispatch, so 2c/2a stop rendering "Sin asignar" for every
// route (routes.vehicle_id/driver_name used to be written only by
// /dispatch, after `loaded` — see this file's DELETE tests' OPEN_ROUTE_STATUSES
// and the dispatch handler).
// ---------------------------------------------------------------------------

function buildPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispatch/routes/r1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface PatchFixture {
  routeStatus: string | null;
  vehicle?: { id: string; capacity_packages: number | null } | null;
  busyRoute?: { id: string } | null;
}

function buildPatchClient({ routeStatus, vehicle = { id: 'veh-1', capacity_packages: 240 }, busyRoute = null }: PatchFixture) {
  const routeSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: routeStatus ? { id: 'r1', status: routeStatus } : null,
      error: null,
    }),
  };

  const vehicleSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: vehicle, error: null }),
  };

  const busyRouteChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: busyRoute, error: null }),
  };

  const routeUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
  const routeUpdateChain = { update: routeUpdateSpy };

  const auditInsertSpy = vi.fn().mockReturnValue({ then: (resolve: (v: unknown) => void) => resolve(null) });

  let routesCallCount = 0;
  const fromMock = vi.fn((table: string) => {
    if (table === 'routes') {
      routesCallCount += 1;
      if (routesCallCount === 1) return routeSelectChain;
      if (routesCallCount === 2) return busyRouteChain;
      return routeUpdateChain;
    }
    if (table === 'fleet_vehicles') return vehicleSelectChain;
    if (table === 'audit_logs') return { insert: auditInsertSpy };
    throw new Error(`unexpected table ${table}`);
  });

  return {
    client: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
          error: null,
        }),
      },
      from: fromMock,
    },
    routeUpdateSpy,
  };
}

describe('PATCH /routes/[id] — assign vehicle + driver before dispatch (spec-76 2d)', () => {
  it('persists vehicle_id and driver_name on an open route', async () => {
    const { client, routeUpdateSpy } = buildPatchClient({ routeStatus: 'planned' });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await PATCH(
      buildPatchRequest({ truck_identifier: 'RTHK-72', driver_name: 'Mario González' }),
      { params },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(routeUpdateSpy).toHaveBeenCalledWith({ vehicle_id: 'veh-1', driver_name: 'Mario González' });
  });

  it('accepts a null driver_name — assignment does not require a driver', async () => {
    const { client, routeUpdateSpy } = buildPatchClient({ routeStatus: 'draft' });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await PATCH(buildPatchRequest({ truck_identifier: 'RTHK-72', driver_name: null }), { params });

    expect(res.status).toBe(200);
    expect(routeUpdateSpy).toHaveBeenCalledWith({ vehicle_id: 'veh-1', driver_name: null });
  });

  it.each(['draft', 'planned', 'loading', 'loaded'])('allows assignment on a %s route', async (status) => {
    const { client } = buildPatchClient({ routeStatus: status });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'RTHK-72' }), { params });
    expect(res.status).toBe(200);
  });

  it.each(['dispatched', 'in_transit', 'completed', 'cancelled'])('refuses assignment on a %s route', async (status) => {
    const { client } = buildPatchClient({ routeStatus: status });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'RTHK-72' }), { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ALREADY_DISPATCHED');
  });

  it('404s for a route that does not exist / belongs to another operator', async () => {
    const { client } = buildPatchClient({ routeStatus: null });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'RTHK-72' }), { params });
    expect(res.status).toBe(404);
  });

  it('400s on a missing truck_identifier', async () => {
    const { client } = buildPatchClient({ routeStatus: 'planned' });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ driver_name: 'Mario' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('422s when the truck_identifier resolves to no fleet_vehicles row — round-trips the same lookup /dispatch relies on', async () => {
    const { client } = buildPatchClient({ routeStatus: 'planned', vehicle: null });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'GHOST-01' }), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('VEHICLE_NOT_FOUND');
  });

  it('422s when the vehicle has no capacity_packages configured — never a fake bar (decision 6)', async () => {
    const { client } = buildPatchClient({ routeStatus: 'planned', vehicle: { id: 'veh-2', capacity_packages: null } });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'ZZ-01' }), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('VEHICLE_CAPACITY_NOT_CONFIGURED');
  });

  it('409s when the vehicle already carries a different route today', async () => {
    const { client } = buildPatchClient({ routeStatus: 'planned', busyRoute: { id: 'other-route-id' } });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'RTHK-72' }), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('VEHICLE_ALREADY_ASSIGNED_TODAY');
  });

  it('401s without a session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    });
    const res = await PATCH(buildPatchRequest({ truck_identifier: 'RTHK-72' }), { params });
    expect(res.status).toBe(401);
  });
});
