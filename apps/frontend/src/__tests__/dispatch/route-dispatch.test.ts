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

/**
 * Generic update/insert chain reused as the fallback for every from() call
 * this handler makes after the first three (routes select, fleet_vehicles,
 * dispatches select): the routes persist update, the packages en_ruta
 * update, and every audit_logs insert.
 *
 * spec-79 B-1: since the default `dispatchesChain()` fixture now carries a
 * genuinely-loaded package (needed to pass the new empty-manifest guard),
 * `.update({status:'en_ruta'})...` actually reaches this mock instead of
 * being skipped, so `.eq()`'s return value has to support BOTH shapes: the
 * routes persist's `.eq(id).eq(operator_id)` (resolves `{error}` directly)
 * and the packages write's longer `.eq(operator_id).in(id).in(status)
 * .is(deleted_at).select(id)` — reporting every requested id as touched, so
 * a test that doesn't care about the F2 mismatch path doesn't have to wire
 * that up by hand (see `packagesEnRutaChain` below for tests that do).
 */
function updateChain() {
  const eqChain = {
    eq: vi.fn().mockResolvedValue({ error: null }),
    in: vi.fn((_col: string, ids: string[]) => ({
      in: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: ids.map((id) => ({ id })), error: null }),
        }),
      }),
    })),
  };
  return {
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(eqChain) }),
    insert: vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) }),
  };
}

/**
 * spec-79 review F1: a genuinely loaded package's fixture now needs
 * loaded_at set and load_inferred false, not just the right `status` — see
 * dispatch-local-completion.ts's loadedPackageIds. Defaults represent a real
 * scan; callers only need to override id/label/status.
 *
 * spec-79 BLOCKER: also defaults `loaded_route_id` to 'r1' — every test in
 * this file dispatches route 'r1' (see every `params: Promise.resolve({ id:
 * 'r1' })`), so a package genuinely loaded onto THIS route, by default,
 * still passes `isGenuinelyLoadedPackage`. The five-step cross-route
 * scenario itself is covered by dispatch-load-state.test.ts; this file
 * stays about the handler's WIRING (which functions get called with what),
 * not the route-scoping predicate.
 */
function genuinelyLoadedPkg(overrides: {
  id: string;
  label: string;
  status: string;
  loaded_at?: string;
  load_inferred?: boolean;
  loaded_route_id?: string | null;
  deleted_at?: string | null;
  sku_items?: unknown;
}) {
  return {
    sku_items: [],
    deleted_at: null,
    loaded_at: '2026-09-04T09:00:00Z',
    load_inferred: false,
    loaded_route_id: 'r1',
    ...overrides,
  };
}

/**
 * spec-79 review F2: the en_ruta write is now `.eq().in('id',...).in('status',...).select('id')`,
 * not a bare `.eq().in()` resolving `{error}`. By default the terminal
 * `.select()` reports back exactly the ids the first `.in('id', ids)` call
 * was given — the ordinary "the write touched everything it asked for" case
 * — so a test that doesn't care about the F2 count-mismatch path doesn't
 * have to wire that up by hand. Pass `updatedIdsOverride` to simulate a
 * status changing out from under the write (fewer rows come back than were
 * requested).
 */
/**
 * spec-79 review F1 (CRITICAL): the write chain is
 * `.eq('operator_id',...).in('id',...).in('status', LOADED_ON_TRUCK_STATUSES)
 * .is('deleted_at', null).select('id')`. `statusInMock` and `isMock` are
 * returned so a test can assert the EXACT argument each was called with —
 * not just that some `.in('status', …)`/`.is('deleted_at', …)` exists in the
 * chain. Two realistic regressions both left every OTHER test in this suite
 * green: widening the status set to admit `dañado`/`retenido` (the exact
 * overwrite the TOCTOU guard exists to refuse), and narrowing it to
 * `['en_carga']` alone (matches nothing on any post-seal route — round 1's
 * bug reintroduced at the UPDATE layer). Only an assertion on the argument
 * itself catches either.
 */
function packagesEnRutaChain(updatedIdsOverride?: string[]) {
  const selectMock = vi.fn();
  const isMock = vi.fn().mockReturnValue({ select: selectMock });
  const statusInMock = vi.fn().mockReturnValue({ is: isMock });
  const idInMock = vi.fn((_col: string, ids: string[]) => {
    const touched = updatedIdsOverride ?? ids;
    selectMock.mockResolvedValue({ data: touched.map((id) => ({ id })), error: null });
    return { in: statusInMock };
  });
  const eqMock = vi.fn().mockReturnValue({ in: idInMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { update: updateMock, select: selectMock, statusInMock, isMock };
}

/** Same shape as packagesEnRutaChain, but the terminal `.select()` resolves
 * an error instead of data — for the packages-write-fails tests. */
function failingPackagesEnRutaChain(error: unknown) {
  const selectMock = vi.fn().mockResolvedValue({ data: null, error });
  const isMock = vi.fn().mockReturnValue({ select: selectMock });
  const statusInMock = vi.fn().mockReturnValue({ is: isMock });
  const idInMock = vi.fn().mockReturnValue({ in: statusInMock });
  const eqMock = vi.fn().mockReturnValue({ in: idInMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { update: updateMock };
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

/**
 * spec-79 B-1: the default carries one genuinely-loaded package — a real
 * dispatch never has zero, and the new empty-manifest guard now refuses one
 * that does (that refusal has its own dedicated describe block below). Tests
 * that specifically care about package contents pass their own `dispatchData`.
 */
function dispatchesChain(dispatchData: unknown[] = [
  {
    id: 'd1',
    order_id: 'o1',
    orders: {
      order_number: '4821',
      customer_name: 'Mario',
      delivery_address: 'Av Principal 1',
      customer_phone: null,
      packages: [genuinelyLoadedPkg({ id: 'pkg-default', label: 'CTN-1', status: 'en_carga' })],
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
    const packagesUpdateChain = packagesEnRutaChain();
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
          packages: [genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'en_carga' })],
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
    const packagesUpdateChain = packagesEnRutaChain();
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
      genuinelyLoadedPkg({ id: 'pkg-loaded', label: 'CTN-1', status: 'en_carga' }),
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
   * spec-79 BLOCKER — the five-step force-split scenario, at the handler
   * level (dispatch-load-state.test.ts covers the same fix at the unit
   * level). Route 'r1' (every test in this file dispatches 'r1') carries a
   * box genuinely loaded onto a DIFFERENT route ('r-other' — the force-split
   * shape: two live dispatches for one order, one per route). Before the
   * BLOCKER fix this box had no route linkage at all, so it read as loaded
   * onto 'r1' too and both en_ruta and the DT manifest picked it up.
   */
  it('BLOCKER: a box genuinely loaded onto a DIFFERENT route is excluded from en_ruta and the DT guide', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-on-r1', label: 'CTN-1', status: 'en_carga', loaded_route_id: 'r1' }),
      genuinelyLoadedPkg({ id: 'pkg-on-other-route', label: 'CTN-2', status: 'en_carga', loaded_route_id: 'r-other' }),
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    // en_ruta write: only the box genuinely loaded onto r1.
    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-on-r1']);

    // DT manifest (buildDtDispatches -> buildItems): same exclusion.
    expect(createDTRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatches: [expect.objectContaining({ items: [expect.objectContaining({ code: 'CTN-1' })] })],
      }),
      expect.any(String),
    );
  });

  /**
   * spec-79 review F1 (CRITICAL): the TOCTOU guard's own filter argument was
   * never asserted anywhere in this suite — only that some `.in('status',
   * …)` existed in the mock chain. Widening the set to admit
   * `dañado`/`retenido` (the exact overwrite this guard exists to refuse) or
   * narrowing it to `['en_carga']` alone (matches nothing on a post-seal
   * route) both left every other test green. This asserts the exact value.
   */
  it('F1: the en_ruta write re-asserts status with exactly LOADED_ON_TRUCK_STATUSES, and deleted_at null', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-loaded', label: 'CTN-1', status: 'en_carga' }),
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    expect(packagesUpdateChain.statusInMock).toHaveBeenCalledWith(
      'status',
      ['en_carga', 'listo_para_despacho'],
    );
    expect(packagesUpdateChain.isMock).toHaveBeenCalledWith('deleted_at', null);
  });

  it('a retenido package (held back in consolidation) does not move to en_ruta', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-loaded', label: 'CTN-1', status: 'en_carga' }),
      // spec-79 F2's own scenario: genuinely scanned once, then held back —
      // status must gate this even though loaded_at is genuine.
      genuinelyLoadedPkg({ id: 'pkg-held', label: 'CTN-2', status: 'retenido' }),
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);

    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-loaded']);
  });

  it('a fully-loaded order: every en_carga package still moves to en_ruta — no regression', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'en_carga' }),
      genuinelyLoadedPkg({ id: 'pkg-2', label: 'CTN-2', status: 'en_carga' }),
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
      genuinelyLoadedPkg({ id: 'pkg-loaded', label: 'CTN-1', status: 'listo_para_despacho' }),
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
   * spec-79 review F1 (CRITICAL, second pass): a package backfilled by
   * spec-74's migration (loaded_at set, load_inferred true) is NOT evidence
   * this specific box was scanned — the migration set it on every live
   * package of an already-staged/adopted order, including one that never
   * left the dock. It must not move to en_ruta alongside a genuinely
   * scanned sibling.
   */
  it('a backfilled (load_inferred) package does not move to en_ruta even at listo_para_despacho', async () => {
    const { client, packagesUpdateChain } = clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-real-scan', label: 'CTN-1', status: 'listo_para_despacho' }),
      {
        id: 'pkg-inferred', label: 'CTN-2', sku_items: [], status: 'listo_para_despacho', deleted_at: null,
        loaded_at: '2026-09-01T00:00:00Z', load_inferred: true,
      },
    ]);
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packages_dispatched).toBe(1);

    const inSpy = packagesUpdateChain.update.mock.results[0].value.eq.mock.results[0].value.in;
    expect(inSpy).toHaveBeenCalledWith('id', ['pkg-real-scan']);
  });

  /**
   * spec-79 review F2: the write re-asserts the source status and checks
   * the row count it actually touched. If a package changed underneath it
   * (e.g. consolidation marked it dañado while DispatchTrack's response was
   * in flight), fewer rows come back than were requested — this must be
   * logged, not silently accepted as if everything went through.
   */
  it('logs a disagreement when the en_ruta write touches fewer packages than expected (F2 TOCTOU guard)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const packagesUpdateChain = packagesEnRutaChain(['pkg-loaded']); // only 1 of 2 requested comes back
    const mismatchAuditInsert = vi.fn().mockReturnValue({ then: (r: () => null) => r() });
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
          packages: [
            genuinelyLoadedPkg({ id: 'pkg-loaded', label: 'CTN-1', status: 'en_carga' }),
            genuinelyLoadedPkg({ id: 'pkg-changed-underneath', label: 'CTN-2', status: 'en_carga' }),
          ],
        },
      }]))
      .mockReturnValueOnce(updateChain())
      .mockReturnValueOnce(packagesUpdateChain)
      .mockReturnValueOnce({ insert: mismatchAuditInsert }) // spec-79 F2: the mismatch's own audit row
      .mockReturnValue(updateChain());
    const client = buildSessionClient({ fromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200); // packages en_ruta write itself did not error
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('en_ruta write touched fewer packages than expected'),
      expect.objectContaining({ routeId: 'r1', expectedCount: 2, updatedCount: 1 }),
    );

    // spec-79 review F2: packages_dispatched must report what was actually
    // WRITTEN (1), never what was merely REQUESTED (2) — the whole point of
    // this guard is that those two can disagree.
    const body = await res.json();
    expect(body.packages_dispatched).toBe(1);

    // spec-79 review F2: every other notable event in this flow gets its own
    // audit_logs row; this disagreement must too, not just a console.error.
    expect(mismatchAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dispatch_en_ruta_count_mismatch',
        resource_type: 'routes',
        resource_id: 'r1',
        changes_json: { expected_count: 2, updated_count: 1 },
      }),
    );
    errorSpy.mockRestore();
  });

  /**
   * spec-79 review finding 1: a `loaded` route with zero loaded boxes is not
   * a normal state. Skipping the write is still correct (an empty .in() is
   * meaningless), but it must not be silent.
   */
  /**
   * spec-79 review B-1 (blocker): this used to be "warns with the routeId
   * when a loaded route has no en_carga/listo_para_despacho packages" and
   * "skips the packages write entirely when nothing is en_carga" — both
   * asserted the route still dispatched to DT with a `200`, only logging or
   * silently skipping the local write. That is exactly the false-negative
   * bargain B-1 replaces: a route with zero genuinely-loaded packages must
   * now be REFUSED before DT is ever called, not silently accepted. See
   * dispatch-dt-payload.test.ts's `findDispatchesWithNoLoadedItems` for the
   * unit-level coverage of the predicate itself.
   */
  it('refuses to dispatch (never calls DT) when a loaded route has no genuinely-loaded packages', async () => {
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
          packages: [{ id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'asignado', deleted_at: null }],
        },
      }]))
      .mockReturnValue(updateChain());
    const client = buildSessionClient({ fromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_MANIFEST');
    expect(createDTRoute).not.toHaveBeenCalled();
  });
});

/**
 * spec-79 review B-1 (blocker). Reproduces the defect end to end against the
 * real handler: `buildItems` filters by `isGenuinelyLoadedPackage`, but
 * `createDTRoute` omits an empty `items` key entirely instead of sending
 * `[]` (dispatchtrack-api.ts). Before this guard, a route with zero
 * genuinely-loaded packages still reached DT as a guide with no contents and
 * was reported `200 {ok:true, packages_dispatched:0}` — permanently
 * `dispatched`, with no recovery path (retry 409s once external_route_id is
 * set, route delete 403s once dispatched). Three real production states
 * reach it; each gets its own case here.
 */
describe('POST /routes/[id]/dispatch — B-1 empty manifest guard', () => {
  function clientWithPackages(packages: unknown[]) {
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
      .mockReturnValue(updateChain());
    return buildSessionClient({ fromMock });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('refuses a pre-spec-74 route sealed and never re-scanned (every box load_inferred)', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientWithPackages([
      {
        id: 'pkg-1', label: 'CTN-1', sku_items: [], status: 'listo_para_despacho', deleted_at: null,
        loaded_at: '2026-01-01T00:00:00Z', load_inferred: true,
      },
    ]));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_MANIFEST');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('refuses a route where every box is retenido after staging (seal passed, nothing genuinely loaded)', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'retenido' }),
    ]));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_MANIFEST');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('refuses a route where every box was soft-deleted after sealing', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'en_carga', deleted_at: '2026-09-05T00:00:00Z' }),
    ]));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_MANIFEST');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  /**
   * The stricter, per-stop variant: nine good stops and one empty one still
   * hands the driver a stop with no contents. The whole route is refused,
   * not just the empty stop — spec-79's no-goals rule out partial dispatch.
   */
  it('refuses the whole route when only ONE of several stops has zero genuinely-loaded boxes', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([
        {
          id: 'd1', order_id: 'o1',
          orders: {
            order_number: '4821', customer_name: 'Mario', delivery_address: 'Av 1', customer_phone: null,
            packages: [genuinelyLoadedPkg({ id: 'pkg-good', label: 'CTN-1', status: 'en_carga' })],
          },
        },
        {
          id: 'd2', order_id: 'o2',
          orders: {
            order_number: '4822', customer_name: 'Ana', delivery_address: 'Av 2', customer_phone: null,
            packages: [genuinelyLoadedPkg({ id: 'pkg-retenido', label: 'CTN-2', status: 'retenido' })],
          },
        },
      ]))
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_MANIFEST');
    expect(body.count).toBe(1);
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('does not refuse a route where every stop has at least one genuinely-loaded box', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientWithPackages([
      genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'en_carga' }),
    ]));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    expect(createDTRoute).toHaveBeenCalled();
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
      .mockReturnValueOnce(updateChain()) // en_ruta write succeeds
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
      .mockReturnValueOnce(updateChain()) // en_ruta write succeeds
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
    const failingPackagesUpdate = failingPackagesEnRutaChain({ message: 'packages update failed' });
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
          packages: [genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'en_carga' })],
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
    const failingPackagesUpdate = failingPackagesEnRutaChain({ message: 'packages update failed' });
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
          packages: [genuinelyLoadedPkg({ id: 'pkg-1', label: 'CTN-1', status: 'en_carga' })],
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

  /**
   * spec-79 review F3: on this exact path (external_route_id already
   * persisted, every package already written to `en_ruta` by the earlier
   * attempt that got this far) loadedPackageIds is legitimately empty.
   * Before F3 this fired the same warn a genuinely empty dispatch does — a
   * false alarm on the exact flow spec-79 exists to make safe.
   *
   * spec-79 review M-1: this same fixture is also the M-1 regression case —
   * `writtenCount` for THIS call is 0 (nothing left to write), but the route
   * genuinely carries one dispatched box. `packages_dispatched` must report
   * 1, not 0, on this exact path.
   */
  it('does NOT warn about zero loaded packages on the sanctioned retry, and reports the true dispatched count (M-1)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ external_route_id: 'ext-already-accepted' }))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain([{
        id: 'd1',
        order_id: 'o1',
        orders: {
          order_number: '4821',
          customer_name: 'Mario',
          delivery_address: 'Av Principal 1',
          customer_phone: null,
          // Already moved to en_ruta by the attempt that got this far —
          // nothing left for THIS write to touch, but it did happen.
          packages: [genuinelyLoadedPkg({ id: 'pkg-already-dispatched', label: 'CTN-1', status: 'en_ruta' })],
        },
      }]))
      .mockReturnValue(updateChain());
    const rpcMock = vi.fn().mockResolvedValue({ data: 'dispatched', error: null });
    const client = buildSessionClient({ fromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.packages_dispatched).toBe(1);
    warnSpy.mockRestore();
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
          packages: [genuinelyLoadedPkg({ id: `p${i}`, label: `CTN-${i}`, status: 'en_carga' })],
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
  // spec-79 review F5: these fixtures now use genuinelyLoadedPkg (status
  // en_carga, loaded_at set, load_inferred false) so buildItems' shared
  // isGenuinelyLoadedPackage predicate includes them — which means
  // loadedPackageIds includes them too, and the en_ruta write actually runs
  // for every case except the empty-packages one. This fallback supports
  // both shapes (packagesEnRutaChain's `.in().in().is().select()` write and
  // a plain `.insert()` audit row) so it works whichever one actually fires.
  function universalChain() {
    const { update } = packagesEnRutaChain();
    return { update, insert: vi.fn().mockReturnValue({ then: (r: () => null) => r() }) };
  }

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
      .mockReturnValueOnce(updateChain()) // persist external_route_id
      .mockReturnValue(universalChain()); // en_ruta write and/or audit rows
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
      genuinelyLoadedPkg({
        id: 'p1', label: 'CTN-1', status: 'en_carga',
        sku_items: [{ sku: 'SKU-1', description: 'Caja QA', quantity: 1 }],
      }),
      genuinelyLoadedPkg({
        id: 'p2', label: 'CTN-2', status: 'en_carga',
        sku_items: [{ sku: 'SKU-2', description: 'Caja QA', quantity: 2 }],
      }),
    ]);
    expect(items).toEqual([
      { code: 'CTN-1', name: 'SKU-1', description: 'Caja QA', quantity: '1' },
      { code: 'CTN-2', name: 'SKU-2', description: 'Caja QA', quantity: '2' },
    ]);
  });

  it('folds a multi-SKU package into one item', async () => {
    const items = await itemsFor([
      genuinelyLoadedPkg({
        id: 'p3', label: 'CTN-3', status: 'en_carga',
        sku_items: [
          { sku: 'SKU-A', description: 'Taladro', quantity: 1 },
          { sku: 'SKU-B', description: 'Broca', quantity: 3 },
        ],
      }),
    ]);
    expect(items).toEqual([
      { code: 'CTN-3', name: 'SKU-A, SKU-B', description: 'Taladro, Broca', quantity: '4' },
    ]);
  });

  it('still lists a package that carries no SKU data', async () => {
    const items = await itemsFor([
      genuinelyLoadedPkg({ id: 'p4', label: 'CTN-4', status: 'en_carga', sku_items: [] }),
    ]);
    expect(items).toEqual([{ code: 'CTN-4', quantity: '1' }]);
  });

  it('leaves soft-deleted packages out', async () => {
    const items = await itemsFor([
      genuinelyLoadedPkg({ id: 'p5', label: 'CTN-5', status: 'en_carga', deleted_at: '2026-08-01T00:00:00Z' }),
      genuinelyLoadedPkg({ id: 'p6', label: 'CTN-6', status: 'en_carga' }),
    ]);
    expect(items.map((i: { code: string }) => i.code)).toEqual(['CTN-6']);
  });

  /**
   * spec-79 review B-1 (blocker): this used to be "sends no items for an
   * order with no packages", asserting the handler dispatched anyway with an
   * empty `items` array. That is exactly the defect B-1 exists to kill — see
   * the dedicated describe block below and dispatch-dt-payload.test.ts.
   */
  it('refuses (EMPTY_MANIFEST) instead of sending an order with no packages', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientWithPackages([]));
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_MANIFEST');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  /**
   * spec-79 review F5: the driver's guide must not list a box our own
   * database refuses to mark en_ruta. A retenido sibling passes the seal
   * (seal-route.ts excludes non-dispatchable statuses so it can't deadlock
   * it) but must not appear in the payload sent to DispatchTrack.
   */
  it('excludes a retenido sibling from the DT guide even though it is not soft-deleted', async () => {
    const items = await itemsFor([
      genuinelyLoadedPkg({ id: 'p7', label: 'CTN-7', status: 'en_carga' }),
      genuinelyLoadedPkg({ id: 'p8', label: 'CTN-8', status: 'retenido' }),
    ]);
    expect(items.map((i: { code: string }) => i.code)).toEqual(['CTN-7']);
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
      .mockReturnValueOnce(updateChain())            // en_ruta write
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
      .mockReturnValueOnce(updateChain())                  // en_ruta write
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
