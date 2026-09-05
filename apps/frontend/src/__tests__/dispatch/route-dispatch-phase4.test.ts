import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('@/lib/dispatchtrack-api', () => ({
  createDTRoute: vi.fn(),
  findExistingDTRoute: vi.fn(),
  DTRejectedError: class DTRejectedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DTRejectedError';
    }
  },
}));

import { createSSRClient } from '@/lib/supabase/server';
import { createDTRoute, findExistingDTRoute } from '@/lib/dispatchtrack-api';
import { POST } from '@/app/api/dispatch/routes/[id]/dispatch/route';
import { NextRequest } from 'next/server';

/**
 * spec-79 Fase 4 — the conditional claim (review finding 4) and the GET
 * pre-check (Fase 0 finding 3, items 13-17). Companion to
 * route-dispatch.test.ts, which covers phases 1-3 and already exercises the
 * FRESH-claim path (every test there gets a successful fresh claim by
 * default via its own `claimChain()`). This file covers the paths that only
 * exist once the claim can fail or be stale-reclaimed.
 */

function buildRequest(body: Record<string, unknown> = { truck_identifier: 'ZALDUENDO' }) {
  return new NextRequest('http://localhost/api/dispatch/routes/r1/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildSessionClient(fromMock: ReturnType<typeof vi.fn>, rpcMock?: ReturnType<typeof vi.fn>) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
        error: null,
      }),
    },
    from: fromMock,
    rpc: rpcMock ?? vi.fn().mockResolvedValue({ data: 'dispatched', error: null }),
  };
}

function routeChain(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'r1',
        status: 'loaded',
        route_date: '2026-03-24',
        external_route_id: 'draft_11111111-1111-1111-1111-111111111111',
        provider: 'dispatchtrack',
        driver_name: null,
        load_position_id: null,
        ...overrides,
      },
      error: null,
    }),
  };
}

function fleetVehicleChain(id: string | null = 'fv-1') {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: id ? { id } : null, error: null }),
  };
}

/** The FRESH half of claimDispatchAttempt: `.is('dispatch_attempt_at', null)`. */
function freshClaimChain(claimed: boolean) {
  const selectMock = vi.fn().mockResolvedValue({ data: claimed ? [{ id: 'r1' }] : [], error: null });
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ select: selectMock }) }),
        }),
      }),
    }),
  };
}

/** The STALE half: `.lt('dispatch_attempt_at', cutoff)`. Only ever reached
 * after a fresh claim has already failed (0 rows). */
function staleClaimChain(claimed: boolean) {
  const selectMock = vi.fn().mockResolvedValue({ data: claimed ? [{ id: 'r1' }] : [], error: null });
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ select: selectMock }) }),
        }),
      }),
    }),
  };
}

function dispatchesChain(dispatchData: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: dispatchData, error: null }),
  };
}

function loadedPkg(id: string, label: string) {
  return {
    id, label, sku_items: [], status: 'en_carga', deleted_at: null,
    loaded_at: '2026-09-05T00:00:00Z', load_inferred: false, loaded_route_id: 'r1',
  };
}

function oneGoodDispatch() {
  return [{
    id: 'd1',
    order_id: 'o1',
    orders: {
      order_number: '4821',
      customer_name: 'Mario',
      delivery_address: 'Av 1',
      customer_phone: null,
      packages: [loadedPkg('p1', 'CTN-1')],
    },
  }];
}

/** Generic update/insert fallback for completeLocalDispatch's own writes
 * (persist, en_ruta, audit) once we're past the parts under test.
 *
 * spec-79 H-1: also the fallback `releaseDispatchClaim` funnels through —
 * it now chains a THIRD `.eq('dispatch_attempt_at', token)` before
 * resolving, so `eqChain.eq` returns itself (chainable AND awaitable at any
 * depth) rather than resolving directly on the second call.
 */
function genericChain() {
  const eqChain: Record<string, unknown> = {};
  eqChain.eq = vi.fn().mockReturnValue(eqChain);
  eqChain.then = (resolve: (v: { error: null }) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve, reject);
  eqChain.in = vi.fn(() => ({
      in: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null }) }),
      }),
    }));
  return {
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(eqChain) }),
    insert: vi.fn().mockReturnValue({ then: (r: () => null) => r() }),
  };
}

describe('POST /routes/[id]/dispatch — Fase 4: conditional claim', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('refuses DISPATCH_IN_PROGRESS (409) when a fresh claim is already held and not stale', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(false))
      .mockReturnValueOnce(staleClaimChain(false));
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('DISPATCH_IN_PROGRESS');
    expect(createDTRoute).not.toHaveBeenCalled();
    expect(findExistingDTRoute).not.toHaveBeenCalled();
  });

  it('item 13: retry after DT_API_ERROR gets a fresh claim (released by the failed attempt) and calls DT directly — no pre-check', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    expect(createDTRoute).toHaveBeenCalled();
    expect(findExistingDTRoute).not.toHaveBeenCalled();
  });
});

describe('POST /routes/[id]/dispatch — Fase 4: stale reclaim triggers the GET pre-check', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('item 15/17: pre-check finds a match — reuses it, never calls createDTRoute, ends dispatched with the matched id', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(false))
      .mockReturnValueOnce(staleClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'found', external_route_id: '222' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.external_route_id).toBe('222');
    expect(createDTRoute).not.toHaveBeenCalled();
    expect(findExistingDTRoute).toHaveBeenCalled();
  });

  it('item 15/17: pre-check finds nothing — creates the route via DT as normal, ends dispatched with the new id', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(false))
      .mockReturnValueOnce(staleClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'not_found' });
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '333' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.external_route_id).toBe('333');
    expect(createDTRoute).toHaveBeenCalled();
  });

  /**
   * spec-79 H-2 (review round 6): `route.ts`'s `resolved.release !== false`
   * survived mutation to a bare `true` — every existing test still passed,
   * because none of them asserted that the claim was actually left in
   * place. Pinned here by counting `fromMock` calls: exactly 5 (route,
   * fresh claim, stale claim, vehicle, dispatches) with NO 6th call for
   * `releaseDispatchClaim`'s own `.from('routes')` — if the mutant fires,
   * that 6th call happens and this assertion catches it directly, not via
   * an incidental side effect.
   */
  it('item 16: ambiguous pre-check refuses RECONCILIATION_REQUIRED (409), never calls DT, and does NOT release the claim (H-2)', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(false))
      .mockReturnValueOnce(staleClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()));
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ambiguous' });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('RECONCILIATION_REQUIRED');
    expect(createDTRoute).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledTimes(5);
  });

  it('item 16: a failed pre-check (throws) also refuses RECONCILIATION_REQUIRED, never falls back to creating', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(false))
      .mockReturnValueOnce(staleClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()));
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DT list routes error 500'));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('RECONCILIATION_REQUIRED');
    expect(createDTRoute).not.toHaveBeenCalled();
    // spec-79 H-2 (review round 6): same pin as the ambiguous case above —
    // no 6th `.from('routes')` call for a release that must not happen.
    expect(fromMock).toHaveBeenCalledTimes(5);
  });

  it('matches by guide identifier, not by truck+date', async () => {
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(false))
      .mockReturnValueOnce(staleClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'not_found' });
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(findExistingDTRoute).toHaveBeenCalledWith(
      { routeDate: '2026-03-24', identifiers: [4821] },
      'test-token',
    );
  });
});

describe('POST /routes/[id]/dispatch — H5a driver_name fallback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });
  });

  it('falls back to the route\'s already-persisted driver_name when driver_identifier is not sent', async () => {
    const routeUpdateChain = { update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }) };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ driver_name: 'Juan Pérez' }))
      .mockReturnValueOnce(freshClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValueOnce(routeUpdateChain)
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));

    const res = await POST(buildRequest({ truck_identifier: 'ZALDUENDO' }), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(200);
    expect(routeUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ driver_name: 'Juan Pérez' }),
    );
  });

  it('an explicit driver_identifier still overrides the persisted driver_name', async () => {
    const routeUpdateChain = { update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }) };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ driver_name: 'Juan Pérez' }))
      .mockReturnValueOnce(freshClaimChain(true))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValueOnce(routeUpdateChain)
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));

    const res = await POST(
      buildRequest({ truck_identifier: 'ZALDUENDO', driver_identifier: 'DT-DRIVER-9' }),
      { params: Promise.resolve({ id: 'r1' }) },
    );

    expect(res.status).toBe(200);
    expect(routeUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ driver_name: 'DT-DRIVER-9' }),
    );
  });
});

describe('POST /routes/[id]/dispatch — H5b vehicle lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
  });

  it('scopes the vehicle lookup by this route\'s own provider, not operator_id alone', async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const vehicleChain = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'fv-1' }, error: null }),
    };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain({ provider: 'simpliroute' }))
      .mockReturnValueOnce(freshClaimChain(true))
      .mockReturnValueOnce(vehicleChain)
      .mockReturnValueOnce(dispatchesChain(oneGoodDispatch()))
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(eqSpy).toHaveBeenCalledWith('provider', 'simpliroute');
  });

  it('500s QUERY_FAILED (not a false 422 VEHICLE_NOT_FOUND) when the vehicle lookup query itself errors', async () => {
    const failingVehicleChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST100', message: 'multiple rows' } }),
    };
    const fromMock = vi.fn()
      .mockReturnValueOnce(routeChain())
      .mockReturnValueOnce(freshClaimChain(true))
      .mockReturnValueOnce(failingVehicleChain)
      .mockReturnValue(genericChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient(fromMock));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
    expect(createDTRoute).not.toHaveBeenCalled();
  });
});
