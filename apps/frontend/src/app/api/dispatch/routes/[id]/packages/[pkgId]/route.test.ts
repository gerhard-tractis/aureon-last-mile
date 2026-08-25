import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { DELETE } from './route';
import { NextRequest } from 'next/server';

const params = Promise.resolve({ id: 'r1', pkgId: 'd1' });

function buildRequest(body: unknown = { reason: 'Cliente canceló' }) {
  return new NextRequest('http://localhost/api/dispatch/routes/r1/packages/d1', {
    method: 'DELETE',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionWithRole(role: string | undefined) {
  return {
    data: {
      session: {
        user: {
          id: 'u1',
          app_metadata: { claims: { operator_id: 'op-1', role } },
        },
      },
    },
    error: null,
  };
}

function buildClient(opts: {
  role?: string;
  routeStatus?: string | null;
  dispatchFound?: boolean;
} = {}) {
  // Not a default parameter: {role: undefined} must mean "no role in the
  // claims", not "fall back to ops_leader" — the exact case the missing-role
  // test needs to exercise.
  const role = 'role' in opts ? opts.role : 'ops_leader';
  const { routeStatus = 'loading', dispatchFound = true } = opts;

  const dispatchChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: dispatchFound
        ? {
            id: 'd1',
            order_id: 'o1',
            route_id: 'r1',
            routes: routeStatus ? { status: routeStatus } : null,
          }
        : null,
      error: null,
    }),
  };

  const dispatchUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
  const dispatchUpdateChain = { update: dispatchUpdateSpy, eq: vi.fn().mockResolvedValue({ error: null }) };
  // Make the two chained .eq() calls after update resolve on the second.
  dispatchUpdateSpy.mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });

  const packagesUpdateSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
  });
  const packagesChain = { update: packagesUpdateSpy };

  const auditInsertSpy = vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) });
  const auditChain = { insert: auditInsertSpy };

  const fromMock = vi.fn((table: string) => {
    if (table === 'dispatches') {
      const calls = fromMock.mock.calls.filter((c) => c[0] === 'dispatches').length;
      return calls <= 1 ? dispatchChain : dispatchUpdateChain;
    }
    if (table === 'packages') return packagesChain;
    if (table === 'audit_logs') return auditChain;
    return dispatchChain;
  });

  return {
    client: {
      auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
      from: fromMock,
    },
    dispatchUpdateSpy,
    packagesUpdateSpy,
    auditInsertSpy,
  };
}

beforeEach(() => vi.resetAllMocks());

describe('DELETE /routes/[id]/packages/[pkgId] — manager-only removal (spec-70 decisions 2 & 3)', () => {
  it.each(['ops_leader', 'operations_manager', 'admin', 'super_admin'])(
    'allows %s to remove a stop',
    async (role) => {
      const { client } = buildClient({ role });
      (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
      const res = await DELETE(buildRequest(), { params });
      expect(res.status).toBe(200);
    },
  );

  it.each(['pickup_leader', 'dispatch_operator', 'warehouse_staff', undefined])(
    'refuses %s with 403',
    async (role) => {
      const { client } = buildClient({ role });
      (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
      const res = await DELETE(buildRequest(), { params });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('FORBIDDEN');
    },
  );

  it('requires a non-empty reason', async () => {
    const { client } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest({ reason: '' }), { params });
    expect(res.status).toBe(400);
  });

  it('400s when reason is missing entirely', async () => {
    const { client } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it('writes the reason to dispatches.removal_reason alongside the soft-delete', async () => {
    const { client, dispatchUpdateSpy } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest({ reason: 'Cliente canceló' }), { params });
    expect(res.status).toBe(200);
    expect(dispatchUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ removal_reason: 'Cliente canceló' }),
    );
  });

  it('resets the package to sectorizado, not asignado', async () => {
    const { client, packagesUpdateSpy } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    expect(packagesUpdateSpy).toHaveBeenCalledWith({ status: 'sectorizado' });
  });

  it('inserts an audit_logs row', async () => {
    const { client, auditInsertSpy } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    await DELETE(buildRequest(), { params });
    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        user_id: 'u1',
        action: 'remove_from_plan',
        resource_type: 'dispatches',
        resource_id: 'd1',
      }),
    );
  });

  it.each(['loaded', 'dispatched', 'in_transit', 'completed'])(
    'refuses removal once the route is %s — manifest is sealed',
    async (routeStatus) => {
      const { client } = buildClient({ routeStatus });
      (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
      const res = await DELETE(buildRequest(), { params });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('ROUTE_SEALED');
    },
  );

  it.each(['draft', 'planned', 'loading'])('allows removal while the route is %s', async (routeStatus) => {
    const { client } = buildClient({ routeStatus });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
  });

  it('404s when the dispatch is not found', async () => {
    const { client } = buildClient({ dispatchFound: false });
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
