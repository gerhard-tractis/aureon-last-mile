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
 * Dispatch route handler call order (happy path):
 *  1. supabase.from('routes').select().eq().eq().is().single()
 *  2. supabase.from('dispatches').select().eq().eq().is()
 *  3. Promise.all([
 *       supabase.from('routes').update().eq().eq(),
 *       supabase.from('packages').update().eq().in(),
 *     ])
 *  4. supabase.from('audit_logs').insert()
 *
 * Error path: createSSRClient() is called a SECOND time inside the catch block
 * for the error audit log. That second client also needs auth.getSession + from('audit_logs').
 */

function buildSessionClient(overrides: {
  fromMock?: ReturnType<typeof vi.fn>;
  auditInsert?: ReturnType<typeof vi.fn>;
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
  };
}

describe('POST /routes/[id]/dispatch — DT failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DT_API_KEY', 'test-token');
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
        data: { id: 'r1', status: 'draft', route_date: '2026-03-24' },
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
      .mockReturnValueOnce(routeChain)      // routes select
      .mockReturnValueOnce(dispatchesChain) // dispatches select
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
        data: { id: 'r1', status: 'draft', route_date: '2026-03-24' },
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
      .mockReturnValueOnce(routeChain)         // routes select
      .mockReturnValueOnce(dispatchesChain)    // dispatches select
      .mockReturnValueOnce(routeUpdateChain)   // routes update (Promise.all[0])
      .mockReturnValueOnce(packagesUpdateChain) // packages update (Promise.all[1])
      .mockReturnValueOnce(auditLogsChain);    // audit_logs insert

    const client = buildSessionClient({ fromMock: successFromMock });
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
  });

  it('returns 409 when route status is not draft', async () => {
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

  it('returns 422 when route has no dispatches', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'r1', status: 'draft', route_date: '2026-03-24' },
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
      .mockReturnValueOnce(dispatchesChain);
    const client = buildSessionClient({ fromMock: primaryFromMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_ROUTE');
  });
});
