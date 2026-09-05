import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('@/lib/dispatchtrack-api', () => ({ createDTRoute: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { createDTRoute } from '@/lib/dispatchtrack-api';
import { POST } from '@/app/api/dispatch/routes/[id]/dispatch/route';
import { NextRequest } from 'next/server';

function buildRequest(body: Record<string, unknown> = { truck_identifier: 'ZALDUENDO' }) {
  return new NextRequest('http://localhost/api/dispatch/routes/r1/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Dispatch route handler call order (spec-79 phases 1-3):
 *  1. supabase.from('routes').select().eq().eq().is().single()          — status must be 'loaded'
 *  2. supabase.from('fleet_vehicles').select().eq().eq().is().maybeSingle() — resolve truck_identifier
 *  3. supabase.from('dispatches').select().eq().eq().is()
 *  4. createDTRoute(...) — SKIPPED entirely when route.external_route_id is
 *     already set (a retry after DT accepted but local completion failed).
 *  5. supabase.from('routes').update({external_route_id, vehicle_id, driver_name}).eq().eq()
 *     — persisted FIRST, its own write, error checked (spec-79 Decision 2).
 *  6. supabase.from('packages').update({status:'en_ruta'}).eq().in('id', loadedPackageIds)
 *     — scoped to boxes actually loaded (spec-79 H3); skipped if none. Runs
 *     BEFORE the transition below on purpose (test at :508-ish): a failure
 *     here must leave routes.status still 'loaded', so the retry path (which
 *     re-enters through the external_route_id check, not through calling DT
 *     again) can still reach this write. Running it after the transition
 *     would strand it behind this handler's own 409 guard, unreachable by
 *     any retry.
 *  7. supabase.rpc('transition_route_status', {..., p_to_status: 'dispatched'}) — error checked.
 *  8. [best-effort, if load_position_id] release_load_position + its audit_logs
 *     row + sweep_load_position_assignments + its audit_logs rows.
 *  9. supabase.from('audit_logs').insert() — 'dispatch_route', best-effort.
 *
 * Any error from step 5 onward (except the best-effort ones in step 8) means
 * DT already confirmed the route: the handler returns 502
 * DT_ACCEPTED_LOCAL_FAILED (with its own audit_logs row) instead of
 * DT_API_ERROR, and never calls DT again on retry.
 */

function fleetVehicleChain(id: string | null = 'fv-1') {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: id ? { id } : null, error: null }),
  };
}

function buildSessionClient(overrides: {
  fromMock?: ReturnType<typeof vi.fn>;
  auditInsert?: ReturnType<typeof vi.fn>;
  rpcMock?: ReturnType<typeof vi.fn>;
} = {}) {
  const auditInsert = overrides.auditInsert ?? vi.fn().mockResolvedValue({ error: null });
  const fromMock = overrides.fromMock ?? vi.fn().mockReturnValue({
    insert: auditInsert,
  });
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            user: {
              id: 'u1',
              app_metadata: { claims: { operator_id: 'op-1' } },
            },
          },
        },
        error: null,
      }),
    },
    from: fromMock,
    rpc: overrides.rpcMock ?? vi.fn().mockResolvedValue({ data: 'dispatched', error: null }),
  };
}

/** Generic update/insert chain reused as the fallback for every from() call
 * this handler makes after the first three (routes select, fleet_vehicles,
 * dispatches select): the routes persist update, the packages en_ruta
 * update, and every audit_logs insert. */
function updateChain() {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    insert: vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) }),
  };
}

function routeChain(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: 'r1', status: 'loaded', route_date: '2026-03-24', ...overrides },
      error: null,
    }),
  };
}

function dispatchesChain(dispatchData: unknown[] = [
  {
    id: 'd1',
    order_id: 'o1',
    orders: {
      order_number: '4821',
      customer_name: 'Mario',
      delivery_address: 'Av Principal 1',
      customer_phone: null,
      // PostgREST returns [] for a declared embed with no rows, never an
      // absent key — the real shape this handler actually receives.
      packages: [],
    },
  },
]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: dispatchData, error: null }),
  };
}

describe('POST /routes/[id]/dispatch — DT failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('returns 401 when no session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      },
    });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 when request body is invalid', async () => {
    const client = buildSessionClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await POST(buildRequest({ truck_identifier: '' }), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 502 and does NOT update packages when DT API throws', async () => {
    const packageUpdateSpy = vi.fn().mockReturnThis();

    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      // If DT throws before any local write, none of these are reached:
      .mockReturnValue({ update: packageUpdateSpy, eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ error: null }) });

    const primaryClient = buildSessionClient({ fromMock: primaryFromMock });

    const auditInsertSpy = vi.fn().mockResolvedValue({ error: null });
    const errorClient = buildSessionClient({
      fromMock: vi.fn().mockReturnValue({ insert: auditInsertSpy }),
    });

    // createSSRClient is called twice: once at the top, once in the catch block
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(primaryClient)
      .mockResolvedValueOnce(errorClient);

    (createDTRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_API_ERROR');
    expect(body.message).toBe('Permission denied');

    expect(packageUpdateSpy).not.toHaveBeenCalled();
    // Route stays untouched: nothing local changed, and dispatch_failed is
    // the only audit row written.
    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispatch_failed', resource_id: 'r1' }),
    );
  });

  it('returns 200 and external_route_id on success', async () => {
    const routeUpdateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    const packagesUpdateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    const auditInsertSpy = vi.fn().mockReturnValue({
      then: vi.fn((resolve: () => null) => resolve()),
    });
    const auditLogsChain = { insert: auditInsertSpy };

    // createDTRoute's external_route_id is always a string (dispatchtrack-api.ts
    // wraps it in String(routeId)) — never a number.
    const successFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages: [{ id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'en_carga', deleted_at: null }],
        },
      }]))
      .mockReturnValueOnce(routeUpdateChain)   // persist external_route_id/vehicle/driver
      .mockReturnValueOnce(packagesUpdateChain) // en_ruta write
      .mockReturnValueOnce(auditLogsChain);    // dispatch_route audit

    const rpcMock = vi.fn().mockResolvedValue({ data: 'dispatched', error: null });
    const client = buildSessionClient({ fromMock: successFromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '99999' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.external_route_id).toBe('99999');
    // spec-79 review finding 9: packages_dispatched is bultos actually
    // loaded (loadedPackageIds), not stops/orders.
    expect(body.packages_dispatched).toBe(1);

    expect(rpcMock).toHaveBeenCalledWith('transition_route_status', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
      p_to_status: 'dispatched',
    });

    expect(routeUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ external_route_id: '99999', vehicle_id: 'fv-1', driver_name: null }),
    );
  });

  it('returns 409 when route status is not loaded', async () => {
    const primaryFromMock = vi.fn().mockReturnValueOnce(routeChain({ status: 'planned' }));
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(409);
  });

  it('reports a failed route lookup as QUERY_FAILED, not 404 or DT_API_ERROR', async () => {
    const failedRouteChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '08006', message: 'connection reset' },
      }),
    };
    const primaryFromMock = vi.fn().mockReturnValueOnce(failedRouteChain);
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  /**
   * spec-79 review finding 3: `if (dErr) throw dErr` sends a failed dispatches
   * SELECT into the outer catch, which reports it as a DispatchTrack
   * rejection (502 DT_API_ERROR + a dispatch_failed audit row) even though DT
   * was never called. Must mirror the routes lookup above.
   */
  it('reports a failed dispatches lookup as QUERY_FAILED, not DT_API_ERROR', async () => {
    const failedDispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: null, error: { code: '08006', message: 'connection reset' } }),
    };
    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(failedDispatchesChain);
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('returns 422 when the truck_identifier does not resolve to a fleet vehicle', async () => {
    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain(null));
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('VEHICLE_NOT_FOUND');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('returns 422 when route has no dispatches', async () => {
    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([]));
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_ROUTE');
  });
});

/**
 * spec-79 phase 1 — H3: `en_ruta` must be scoped to boxes actually on the
 * truck (`en_carga`), never to every package of every dispatched order.
 */
describe('POST /routes/[id]/dispatch — H3 en_ruta scoped to loaded packages', () => {
  function clientWithPackages(packages: unknown[]) {
    const packagesUpdateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages,
        },
      }]))
      .mockReturnValueOnce(updateChain())       // persist external_route_id
      .mockReturnValueOnce(packagesUpdateChain) // en_ruta write
      .mockReturnValue(updateChain());          // final dispatch_route audit
    return { client: buildSessionClient({ fromMock }), packagesUpdateChain };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });
  });

  it('a split order: only the en_carga package moves to en_ruta, the asignado one stays put', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      { id: 'pkg-loaded', label: 'CTN-1', sku_items: [], status: 'en_carga', deleted_at: null },
      { id: 'pkg-on-dock', label: 'CTN-2', sku_items: [], status: 'asignado', deleted_at: null },
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(packagesUpdateChain.update).toHaveBeenCalledWith({ status: 'en_ruta' });
    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-loaded']);
  });

  it('a retenido package (held back in consolidation) does not move to en_ruta', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      { id: 'pkg-loaded', label: 'CTN-1', sku_items: [], status: 'en_carga', deleted_at: null },
      { id: 'pkg-held', label: 'CTN-2', sku_items: [], status: 'retenido', deleted_at: null },
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-loaded']);
  });

  it('a fully-loaded order: every en_carga package still moves to en_ruta — no regression', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      { id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'en_carga', deleted_at: null },
      { id: 'pkg-2', label: 'CTN-2', sku_items: [], status: 'en_carga', deleted_at: null },
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-1', 'pkg-2']);
  });

  /**
   * spec-79 review finding 1 (CRITICAL): the only way a route reaches
   * `loaded` is /seal, and /seal moves every staged package OFF `en_carga`
   * to `listo_para_despacho` (seal-route.ts:284-288) before it flips
   * routes.status. So at dispatch time the boxes that actually rode the
   * truck are `listo_para_despacho`, not `en_carga` — the en_carga-only
   * filter matched nothing and en_ruta was never written. No test caught
   * this because none used a post-seal fixture until now.
   */
  it('a post-seal route: packages already moved to listo_para_despacho by /seal still move to en_ruta', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      { id: 'pkg-loaded', label: 'CTN-1', sku_items: [], status: 'listo_para_despacho', deleted_at: null },
      { id: 'pkg-on-dock', label: 'CTN-2', sku_items: [], status: 'asignado', deleted_at: null },
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(packagesUpdateChain.update).toHaveBeenCalledWith({ status: 'en_ruta' });
    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-loaded']);
  });

  /**
   * spec-79 review finding 1: a `loaded` route with zero loaded boxes is not
   * a normal state. Skipping the write is still correct (an empty .in() is
   * meaningless), but it must not be silent.
   */
  it('warns with the routeId when a loaded route has no en_carga/listo_para_despacho packages', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const packagesFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages: [{ id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'asignado', deleted_at: null }],
        },
      }]))
      .mockReturnValue(updateChain());
    const client = buildSessionClient({ fromMock: packagesFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ routeId: 'r1' }));
    warnSpy.mockRestore();
  });

  it('skips the packages write entirely when nothing is en_carga', async () => {
    const packagesFromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages: [{ id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'asignado', deleted_at: null }],
        },
      }]))
      .mockReturnValue(updateChain());
    const client = buildSessionClient({ fromMock: packagesFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    // Only 5 from() calls: routes, fleet_vehicles, dispatches, routes-persist,
    // dispatch_route audit. No 6th call for a packages update.
    expect(packagesFromMock).toHaveBeenCalledTimes(5);
  });
});

/**
 * spec-79 phase 2/3 — H2: `external_route_id` is persisted first and its
 * error checked; any post-DT failure is DT_ACCEPTED_LOCAL_FAILED, never a
 * silent 200 and never DT_API_ERROR.
 */
describe('POST /routes/[id]/dispatch — H2 persist-first and failure classification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: 'ext-77' });
  });

  it('does NOT silently return 200 when the routes persist UPDATE fails — the error is checked', async () => {
    const failingRouteUpdate = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'db write failed' } }),
        }),
      }),
    };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValueOnce(failingRouteUpdate)
      .mockReturnValue(updateChain()); // dispatch_accepted_local_failed audit row
    const client = buildSessionClient({ fromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_ACCEPTED_LOCAL_FAILED');
    expect(body.external_route_id).toBe('ext-77');
  });

  /**
   * spec-79 review finding 2: supabase-js RESOLVES {data, error} on a DB
   * rejection, it does not reject the promise. The dispatch_accepted_local_failed
   * insert wraps its call in try/catch alone, so a DB-rejected insert (RLS,
   * constraint, timeout) was dropped with no log — the only local trace of a
   * route that exists at DispatchTrack, gone silently.
   */
  it('logs when the dispatch_accepted_local_failed audit insert itself is rejected by the DB', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rejectedAuditInsert = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'insert violates RLS' },
    });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValueOnce(updateChain()) // persist succeeds
      .mockReturnValueOnce({ insert: rejectedAuditInsert }); // dispatch_accepted_local_failed insert rejected
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'transition failed' } });
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_ACCEPTED_LOCAL_FAILED');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ externalRouteId: 'ext-77' }),
    );
    errorSpy.mockRestore();
  });

  it('DT throws (rejection) → 502 DT_API_ERROR, route intact, no packages moved', async () => {
    const packageUpdateSpy = vi.fn();
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue({ update: packageUpdateSpy, insert: vi.fn().mockResolvedValue({ error: null }) });
    const errorClient = buildSessionClient({ fromMock: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }) });
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildSessionClient({ fromMock }))
      .mockResolvedValueOnce(errorClient);
    (createDTRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DT rejected the request'));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_API_ERROR');
    expect(packageUpdateSpy).not.toHaveBeenCalled();
  });

  it('DT confirms and transition_route_status fails → DT_ACCEPTED_LOCAL_FAILED with its own audit row and external_route_id, never DT_API_ERROR', async () => {
    const acceptedAuditInsert = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValueOnce(updateChain()) // persist succeeds
      .mockReturnValueOnce({ insert: acceptedAuditInsert }); // dispatch_accepted_local_failed
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'transition failed' } });
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_ACCEPTED_LOCAL_FAILED');
    expect(body.external_route_id).toBe('ext-77');

    expect(acceptedAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dispatch_accepted_local_failed',
        resource_type: 'routes',
        resource_id: 'r1',
        changes_json: expect.objectContaining({ external_route_id: 'ext-77' }),
      }),
    );
  });

  it('the packages en_ruta write failing is also DT_ACCEPTED_LOCAL_FAILED, not a silent 200', async () => {
    const failingPackagesUpdate = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: { message: 'packages update failed' } }),
        }),
      }),
    };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages: [{ id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'en_carga', deleted_at: null }],
        },
      }]))
      .mockReturnValueOnce(updateChain())        // persist succeeds
      .mockReturnValueOnce(failingPackagesUpdate) // en_ruta write fails
      .mockReturnValue(updateChain());           // audit row
    const client = buildSessionClient({ fromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_ACCEPTED_LOCAL_FAILED');
  });

  it('a packages-update failure happens BEFORE transition_route_status, so the route stays retryable instead of stranded behind a 409', async () => {
    // Self-review fix: packages must be written before the state-flipping
    // transition_route_status RPC. If it ran after, a packages failure would
    // leave routes.status already 'dispatched', and this handler's own
    // route.status !== 'loaded' guard would 409 every future retry attempt
    // — the operator could never reach a retry path that completes the
    // packages write.
    const failingPackagesUpdate = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: { message: 'packages update failed' } }),
        }),
      }),
    };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages: [{ id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'en_carga', deleted_at: null }],
        },
      }]))
      .mockReturnValueOnce(updateChain())         // persist succeeds
      .mockReturnValueOnce(failingPackagesUpdate) // en_ruta write fails
      .mockReturnValue(updateChain());            // dispatch_accepted_local_failed audit
    const rpcMock = vi.fn().mockResolvedValue({ data: 'dispatched', error: null });
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_ACCEPTED_LOCAL_FAILED');
    // transition_route_status must never have been reached.
    expect(rpcMock.mock.calls.some((c) => c[0] === 'transition_route_status')).toBe(false);
  });

  it('best-effort failures (release_load_position, its sweep) still return 200 — not hardened by accident', async () => {
    const rpcMock = vi.fn((fn: string) => {
      if (fn === 'release_load_position') return Promise.resolve({ data: null, error: { message: 'db error' } });
      return Promise.resolve({ data: 'dispatched', error: null });
    });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
  });
});

/**
 * spec-79 phase 3 — the retry path. A route that already carries an
 * external_route_id was accepted by DT on a previous attempt; retrying must
 * never call DT again (it has no idempotency key — spec-79 phase 0) and
 * must complete only the local work.
 */
describe('POST /routes/[id]/dispatch — retry after DT_ACCEPTED_LOCAL_FAILED', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('never calls DT again when external_route_id is already persisted, and completes local work', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ external_route_id: 'ext-already-accepted' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    const rpcMock = vi.fn().mockResolvedValue({ data: 'dispatched', error: null });
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(createDTRoute).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.external_route_id).toBe('ext-already-accepted');
    expect(rpcMock).toHaveBeenCalledWith('transition_route_status', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
      p_to_status: 'dispatched',
    });
  });

  it('a retry that fails again stays DT_ACCEPTED_LOCAL_FAILED and still never calls DT', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ external_route_id: 'ext-already-accepted' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'still failing' } });
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(createDTRoute).not.toHaveBeenCalled();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_ACCEPTED_LOCAL_FAILED');
    expect(body.external_route_id).toBe('ext-already-accepted');
  });

  it('skips MISSING_ORDER_NUMBER validation on retry — DT already has the guide', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ external_route_id: 'ext-already-accepted' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1', order_id: 'o1',
        orders: { order_number: '   ', customer_name: 'Mario', delivery_address: 'Av 1', customer_phone: null },
      }]))
      .mockReturnValue(updateChain());
    const client = buildSessionClient({ fromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(createDTRoute).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

/**
 * Which env var carries the DispatchTrack token. Every other consumer
 * (scripts/*.mjs, the dispatchtrack-route-poll edge function) reads
 * DISPATCHTRACK_API_KEY; this handler used to read DT_API_KEY alone, which
 * nothing sets, so dispatching failed with "not configured" everywhere. The
 * old name stays as a fallback in case a deployed environment still sets it.
 */
describe('POST /routes/[id]/dispatch — token resolution', () => {
  function loadedRouteClient() {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    return buildSessionClient({ fromMock });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it('passes DISPATCHTRACK_API_KEY to the DT client', async () => {
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'canonical-token');
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(loadedRouteClient());
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    expect((createDTRoute as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('canonical-token');
  });

  it('falls back to DT_API_KEY when the canonical name is unset', async () => {
    vi.stubEnv('DT_API_KEY', 'legacy-token');
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(loadedRouteClient());
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    expect((createDTRoute as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('legacy-token');
  });

  // spec-79 review finding 3: an unconfigured token is a server
  // misconfiguration, not a DispatchTrack rejection — it must not read as
  // DT_API_ERROR when DT was never called.
  it('returns 500 QUERY_FAILED and never calls DT when no token is configured', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(loadedRouteClient());

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
    expect(createDTRoute).not.toHaveBeenCalled();
  });
});

/**
 * dispatches.identifier is DispatchTrack's guide number, and it is the same
 * value the inbound beetrack-webhook matches on (orders.order_number) and the
 * one scripts/sync-pending-orders.mjs passes to GET /dispatches/:identifier.
 * The handler used to strip non-digits out of order_number, which silently
 * invented a different guide number for anything not already all-digits.
 */
describe('POST /routes/[id]/dispatch — dispatch identifier', () => {
  function clientForOrderNumbers(orderNumbers: string[]) {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(orderNumbers.map((order_number, i) => ({
        id: `d${i}`,
        order_id: `o${i}`,
        orders: {
          order_number,
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
        },
      }))))
      .mockReturnValue(updateChain());
    return buildSessionClient({ fromMock });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('sends order_number as the guide number, unmodified', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValue(clientForOrderNumbers(['2916967493']));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    const sent = (createDTRoute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.dispatches[0].identifier).toBe(2916967493);
  });

  it('sends a non-numeric guide number as the string it is', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValue(clientForOrderNumbers(['CARGA-EASY-001-ORD-101']));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    const sent = (createDTRoute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.dispatches[0].identifier).toBe('CARGA-EASY-001-ORD-101');
  });

  it('keeps a guide number too large for an exact integer as a string', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValue(clientForOrderNumbers(['99999999999999999999']));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    const sent = (createDTRoute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.dispatches[0].identifier).toBe('99999999999999999999');
  });

  it('refuses the dispatch when an order carries no guide number at all', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValue(clientForOrderNumbers(['2916967493', '   ']));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('MISSING_ORDER_NUMBER');
    expect(createDTRoute).not.toHaveBeenCalled();
  });
});

/**
 * dispatches.items[] is what makes a guide show its contents in DispatchTrack.
 * The first live dispatch reached Musan's tenant with the orders but no items,
 * because the payload never carried any. One item per package: `code` is the
 * package label — the physical thing the operator handles — with the SKU lines
 * folded into name/description/quantity.
 */
describe('POST /routes/[id]/dispatch — items', () => {
  function clientWithPackages(packages: unknown[]) {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd0',
        order_id: 'o0',
        orders: {
          order_number: '2916967493',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          packages,
        },
      }]))
      .mockReturnValue(updateChain());
    return buildSessionClient({ fromMock });
  }

  async function itemsFor(packages: unknown[]) {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientWithPackages(packages));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
    return (createDTRoute as ReturnType<typeof vi.fn>).mock.calls[0][0].dispatches[0].items;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('sends one item per package, keyed by the package label', async () => {
    const items = await itemsFor([
      { label: 'CTN-1', sku_items: [{ sku: 'SKU-1', description: 'Caja QA', quantity: 1 }], deleted_at: null },
      { label: 'CTN-2', sku_items: [{ sku: 'SKU-2', description: 'Caja QA', quantity: 2 }], deleted_at: null },
    ]);
    expect(items).toEqual([
      { code: 'CTN-1', name: 'SKU-1', description: 'Caja QA', quantity: '1' },
      { code: 'CTN-2', name: 'SKU-2', description: 'Caja QA', quantity: '2' },
    ]);
  });

  it('folds a multi-SKU package into one item', async () => {
    const items = await itemsFor([
      {
        label: 'CTN-3',
        sku_items: [
          { sku: 'SKU-A', description: 'Taladro', quantity: 1 },
          { sku: 'SKU-B', description: 'Broca', quantity: 3 },
        ],
        deleted_at: null,
      },
    ]);
    expect(items).toEqual([
      { code: 'CTN-3', name: 'SKU-A, SKU-B', description: 'Taladro, Broca', quantity: '4' },
    ]);
  });

  it('still lists a package that carries no SKU data', async () => {
    const items = await itemsFor([{ label: 'CTN-4', sku_items: null, deleted_at: null }]);
    expect(items).toEqual([{ code: 'CTN-4', quantity: '1' }]);
  });

  it('leaves soft-deleted packages out', async () => {
    const items = await itemsFor([
      { label: 'CTN-5', sku_items: [], deleted_at: '2026-08-01T00:00:00Z' },
      { label: 'CTN-6', sku_items: [], deleted_at: null },
    ]);
    expect(items.map((i: { code: string }) => i.code)).toEqual(['CTN-6']);
  });

  it('sends no items for an order with no packages', async () => {
    const items = await itemsFor([]);
    expect(items).toEqual([]);
  });
});

/**
 * spec-71 Decision 8: release happens at `dispatched`. load_position_id is
 * LEFT SET on the route row (Decision 4) — only release_load_position and its
 * audit_logs row are new here.
 */
describe('POST /routes/[id]/dispatch — spec-71 load position release', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });
  });

  it('calls release_load_position when the route holds a position', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(rpcMock).toHaveBeenCalledWith('release_load_position', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
      p_user_id: 'u1',
    });
  });

  it('does not call release_load_position when the route never held a position', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(rpcMock.mock.calls.filter((c) => c[0] === 'release_load_position')).toEqual([]);
  });

  it('writes an audit_logs row for the release', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const releaseAuditInsert = vi.fn().mockReturnValue({ then: (r: () => null) => r() });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValueOnce(updateChain())            // persist external_route_id (now first)
      .mockReturnValueOnce({ insert: releaseAuditInsert }) // release_load_position's own audit row
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(releaseAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        user_id: 'u1',
        action: 'release_load_position',
        resource_type: 'routes',
        resource_id: 'r1',
        changes_json: {
          load_position_id: 'pos-1',
          previous_state: 'occupied',
          new_state: 'released',
        },
      }),
    );
  });

  it('a failed/thrown release_load_position never fails the dispatch', async () => {
    const rpcMock = vi.fn((fn: string) =>
      fn === 'release_load_position'
        ? Promise.resolve({ data: null, error: { message: 'db error' } })
        : Promise.resolve({ data: 'dispatched', error: null }),
    );
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
  });

  /**
   * spec-71 phase 2 code-review fix: the missing re-attempt on release.
   * release_load_position only frees a position; sweep_load_position_assignments
   * is what re-attempts assignment for a route that missed out earlier, and it
   * must run right after a successful release.
   */
  it('sweeps for routes that missed a position after a successful release', async () => {
    const rpcMock = vi.fn((fn: string) => {
      if (fn === 'release_load_position') return Promise.resolve({ data: null, error: null });
      if (fn === 'sweep_load_position_assignments') {
        return Promise.resolve({ data: [{ route_id: 'r7', load_position_id: 'pos-1' }], error: null });
      }
      return Promise.resolve({ data: 'dispatched', error: null });
    });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(rpcMock).toHaveBeenCalledWith('sweep_load_position_assignments', {
      p_operator_id: 'op-1',
      p_user_id: 'u1',
    });
  });

  it('writes an audit_logs row for each route the sweep assigned a position to', async () => {
    const rpcMock = vi.fn((fn: string) => {
      if (fn === 'release_load_position') return Promise.resolve({ data: null, error: null });
      if (fn === 'sweep_load_position_assignments') {
        return Promise.resolve({
          data: [
            { route_id: 'r7', load_position_id: 'pos-1' },
            { route_id: 'r8', load_position_id: 'pos-2' },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: 'dispatched', error: null });
    });
    const sweepAuditInsert = vi.fn().mockReturnValue({ then: (r: () => null) => r() });
    const releaseAuditInsert = vi.fn().mockReturnValue({ then: (r: () => null) => r() });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValueOnce(updateChain())                  // persist external_route_id (now first)
      .mockReturnValueOnce({ insert: releaseAuditInsert }) // release_load_position's own audit row
      .mockReturnValueOnce({ insert: sweepAuditInsert })   // sweep audit row for r7
      .mockReturnValueOnce({ insert: sweepAuditInsert })   // sweep audit row for r8
      .mockReturnValue(updateChain());                     // final audit row
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(sweepAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assign_load_position',
        resource_type: 'routes',
        resource_id: 'r7',
        changes_json: { load_position_id: 'pos-1', via: 'sweep_after_release' },
      }),
    );
    expect(sweepAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: 'r8',
        changes_json: { load_position_id: 'pos-2', via: 'sweep_after_release' },
      }),
    );
  });

  it('a failed/thrown sweep_load_position_assignments never fails the dispatch', async () => {
    const rpcMock = vi.fn((fn: string) => {
      if (fn === 'release_load_position') return Promise.resolve({ data: null, error: null });
      if (fn === 'sweep_load_position_assignments') {
        return Promise.resolve({ data: null, error: { message: 'sweep db error' } });
      }
      return Promise.resolve({ data: 'dispatched', error: null });
    });
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ load_position_id: 'pos-1' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
  });
});
