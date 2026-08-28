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
 * Dispatch route handler call order (happy path, spec-70 phase 3):
 *  1. supabase.from('routes').select().eq().eq().is().single()          — status must be 'loaded'
 *  2. supabase.from('fleet_vehicles').select().eq().eq().is().maybeSingle() — resolve truck_identifier
 *  3. supabase.from('dispatches').select().eq().eq().is()
 *  4. supabase.rpc('transition_route_status', {..., p_to_status: 'dispatched'})
 *  5. Promise.all([
 *       supabase.from('routes').update({external_route_id, vehicle_id, driver_name}).eq().eq(),
 *       supabase.from('packages').update().eq().in(),
 *     ])
 *  6. supabase.from('audit_logs').insert()
 *
 * Error path: createSSRClient() is called a SECOND time inside the catch block
 * for the error audit log. That second client also needs auth.getSession + from('audit_logs').
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
    // routes chain — not even reached but needs a from mock for routes
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await POST(buildRequest({ truck_identifier: '' }), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 502 and does NOT update packages when DT API throws', async () => {
    // ---- Primary client (called at top of handler) ----
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };

    const dispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'd1',
            order_id: 'o1',
            orders: {
              order_number: '4821',
              customer_name: 'Mario',
              delivery_address: 'Av Principal 1',
              customer_phone: null,
            },
          },
        ],
        error: null,
      }),
    };

    // packages.update — should NOT be called if DT throws
    const packageUpdateSpy = vi.fn().mockReturnThis();

    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain)         // routes select
      .mockReturnValueOnce(fleetVehicleChain()) // fleet_vehicles select
      .mockReturnValueOnce(dispatchesChain)    // dispatches select
      // If DT throws before Promise.all, these won't be called:
      .mockReturnValue({ update: packageUpdateSpy, eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ error: null }) });

    const primaryClient = buildSessionClient({ fromMock: primaryFromMock });

    // ---- Error-audit client (called inside catch block) ----
    const auditInsertSpy = vi.fn().mockResolvedValue({ error: null });
    const errorClient = buildSessionClient({
      fromMock: vi.fn().mockReturnValue({ insert: auditInsertSpy }),
    });

    // createSSRClient is called twice: once at the top, once in the catch block
    (createSSRClient as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(primaryClient)  // first call — main handler
      .mockResolvedValueOnce(errorClient);   // second call — catch block audit

    (createDTRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('DT_API_ERROR');
    expect(body.message).toBe('Permission denied');

    // packages.update with 'en_ruta' must NOT have been called
    expect(packageUpdateSpy).not.toHaveBeenCalled();
  });

  it('returns 200 and external_route_id on success', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };

    const dispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'd1',
            order_id: 'o1',
            orders: {
              order_number: '4821',
              customer_name: 'Mario',
              delivery_address: 'Av Principal 1',
              customer_phone: '555-1234',
            },
          },
        ],
        error: null,
      }),
    };

    // routes update chain
    const routeUpdateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    // packages update chain
    const packagesUpdateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    // audit_logs insert chain
    const auditInsertSpy = vi.fn().mockReturnValue({
      then: vi.fn((resolve: () => null) => resolve()),
    });
    const auditLogsChain = { insert: auditInsertSpy };

    const successFromMock = vi.fn()
      .mockReturnValueOnce(routeChain)          // routes select
      .mockReturnValueOnce(fleetVehicleChain()) // fleet_vehicles select
      .mockReturnValueOnce(dispatchesChain)     // dispatches select
      .mockReturnValueOnce(routeUpdateChain)    // routes update (Promise.all[0])
      .mockReturnValueOnce(packagesUpdateChain) // packages update (Promise.all[1])
      .mockReturnValueOnce(auditLogsChain);     // audit_logs insert

    const rpcMock = vi.fn().mockResolvedValue({ data: 'dispatched', error: null });
    const client = buildSessionClient({ fromMock: successFromMock, rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({
      external_route_id: 99999,
    });

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.external_route_id).toBe(99999);
    expect(body.packages_dispatched).toBe(1);

    // The status change went through the RPC, not a raw UPDATE.
    expect(rpcMock).toHaveBeenCalledWith('transition_route_status', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
      p_to_status: 'dispatched',
    });

    // Vehicle and driver were persisted, not left only in React state.
    expect(routeUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: 'fv-1', driver_name: null }),
    );
  });

  it('returns 409 when route status is not loaded', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'planned', route_date: '2026-03-24' },
        error: null,
      }),
    };

    const primaryFromMock = vi.fn().mockReturnValueOnce(routeChain);
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(409);
  });

  /**
   * A query that failed to run is not the same fact as "no such route", and
   * the outer catch would otherwise report it as a DispatchTrack failure it
   * never got the chance to attempt.
   */
  it('reports a failed route lookup as QUERY_FAILED, not 404 or DT_API_ERROR', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '08006', message: 'connection reset' },
      }),
    };
    const primaryFromMock = vi.fn().mockReturnValueOnce(routeChain);
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('returns 422 when the truck_identifier does not resolve to a fleet vehicle', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };

    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain)
      .mockReturnValueOnce(fleetVehicleChain(null)); // no vehicle found
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('VEHICLE_NOT_FOUND');
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('returns 422 when route has no dispatches', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };

    const dispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    const primaryFromMock = vi.fn()
      .mockReturnValueOnce(routeChain)
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain);
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_ROUTE');
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
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };
    const dispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{
          id: 'd1',
          order_id: 'o1',
          orders: {
            order_number: '4821',
            customer_name: 'Mario',
            delivery_address: 'Av Principal 1',
            customer_phone: null,
          },
        }],
        error: null,
      }),
    };
    const updateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
          in: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) }),
    };
    return buildSessionClient({
      fromMock: vi.fn()
        .mockReturnValueOnce(routeChain)
        .mockReturnValueOnce(fleetVehicleChain())
        .mockReturnValueOnce(dispatchesChain)
        .mockReturnValue(updateChain),
    });
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

  it('returns 502 and never calls DT when no token is configured', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(loadedRouteClient());

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });

    expect(res.status).toBe(502);
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
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };
    const dispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: orderNumbers.map((order_number, i) => ({
          id: `d${i}`,
          order_id: `o${i}`,
          orders: {
            order_number,
            customer_name: 'Mario',
            delivery_address: 'Av Principal 1',
            customer_phone: null,
          },
        })),
        error: null,
      }),
    };
    const updateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
          in: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) }),
    };
    return buildSessionClient({
      fromMock: vi.fn()
        .mockReturnValueOnce(routeChain)
        .mockReturnValueOnce(fleetVehicleChain())
        .mockReturnValueOnce(dispatchesChain)
        .mockReturnValue(updateChain),
    });
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
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24' },
        error: null,
      }),
    };
    const dispatchesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{
          id: 'd0',
          order_id: 'o0',
          orders: {
            order_number: '2916967493',
            customer_name: 'Mario',
            delivery_address: 'Av Principal 1',
            customer_phone: null,
            packages,
          },
        }],
        error: null,
      }),
    };
    const updateChain = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
          in: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) }),
    };
    return buildSessionClient({
      fromMock: vi.fn()
        .mockReturnValueOnce(routeChain)
        .mockReturnValueOnce(fleetVehicleChain())
        .mockReturnValueOnce(dispatchesChain)
        .mockReturnValue(updateChain),
    });
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
  function loadedRouteChain(loadPositionId: string | null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'loaded', route_date: '2026-03-24', load_position_id: loadPositionId },
        error: null,
      }),
    };
  }

  function dispatchesChain() {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{
          id: 'd1',
          order_id: 'o1',
          orders: { order_number: '4821', customer_name: 'Mario', delivery_address: 'Av 1', customer_phone: null },
        }],
        error: null,
      }),
    };
  }

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

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DISPATCHTRACK_API_KEY', 'test-token');
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });
  });

  it('calls release_load_position when the route holds a position', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromMock = vi.fn()
      .mockReturnValueOnce(loadedRouteChain('pos-1'))
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
      .mockReturnValueOnce(loadedRouteChain(null))
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
      .mockReturnValueOnce(loadedRouteChain('pos-1'))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
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
      .mockReturnValueOnce(loadedRouteChain('pos-1'))
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
      .mockReturnValueOnce(loadedRouteChain('pos-1'))
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
      .mockReturnValueOnce(loadedRouteChain('pos-1'))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValueOnce({ insert: releaseAuditInsert }) // release_load_position's own audit row
      .mockReturnValueOnce({ insert: sweepAuditInsert })   // sweep audit row for r7
      .mockReturnValueOnce({ insert: sweepAuditInsert })   // sweep audit row for r8
      .mockReturnValue(updateChain());                     // routes/packages update + final audit row
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
      .mockReturnValueOnce(loadedRouteChain('pos-1'))
      .mockReturnValueOnce(fleetVehicleChain())
      .mockReturnValueOnce(dispatchesChain())
      .mockReturnValue(updateChain());
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildSessionClient({ fromMock, rpcMock }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(200);
  });
});
