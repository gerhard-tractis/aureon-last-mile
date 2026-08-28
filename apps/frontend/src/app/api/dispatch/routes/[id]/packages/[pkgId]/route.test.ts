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
  dispatchQueryError?: { code: string; message: string };
  rpcMock?: ReturnType<typeof vi.fn>;
} = {}) {
  // Not a default parameter: {role: undefined} must mean "no role in the
  // claims", not "fall back to ops_leader" — the exact case the missing-role
  // test needs to exercise.
  const role = 'role' in opts ? opts.role : 'ops_leader';
  const { routeStatus = 'loading', dispatchFound = true, dispatchQueryError } = opts;

  const dispatchChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      dispatchQueryError
        ? { data: null, error: dispatchQueryError }
        : {
            data: dispatchFound
              ? {
                  id: 'd1',
                  order_id: 'o1',
                  route_id: 'r1',
                  routes: routeStatus ? { status: routeStatus } : null,
                }
              : null,
            error: null,
          },
    ),
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

  const rpcMock = opts.rpcMock ?? vi.fn().mockResolvedValue({ data: { conflict: false }, error: null });

  return {
    client: {
      auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
      from: fromMock,
      rpc: rpcMock,
    },
    dispatchUpdateSpy,
    packagesUpdateSpy,
    auditInsertSpy,
    rpcMock,
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

  /**
   * Fails closed: a route that cannot be resolved must refuse, not proceed.
   * ownsTheOrder (scan-validator.ts) makes the same call in the same
   * situation — two sibling guards with opposite defaults is how a bypass
   * gets shipped.
   */
  it('refuses removal when the route cannot be resolved, rather than proceeding', async () => {
    const { client } = buildClient({ routeStatus: null });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('ROUTE_SEALED');
  });

  /**
   * A query that failed to run is not the same fact as "no such dispatch" —
   * reporting it as 404 is exactly the confusion scan-validator.ts's header
   * documents as having hidden three broken queries for months.
   */
  it('reports a failed dispatch lookup as QUERY_FAILED, not 404', async () => {
    const { client } = buildClient({ dispatchQueryError: { code: '08006', message: 'connection reset' } });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_FAILED');
  });

  it('treats PGRST116 (no row matched) as a genuine 404, not QUERY_FAILED', async () => {
    const { client } = buildClient({ dispatchQueryError: { code: 'PGRST116', message: 'no rows' } });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(404);
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

/**
 * spec-71 Decision 7 residual risk: removing a stop changes the route's
 * dispatch set too, so the offset conflict must be re-checked and surfaced.
 */
describe('DELETE /routes/[id]/packages/[pkgId] — spec-71 offset re-check', () => {
  it('calls check_load_position_conflict with the dispatch\'s route_id', async () => {
    const { client, rpcMock } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    await DELETE(buildRequest(), { params });
    expect(rpcMock).toHaveBeenCalledWith('check_load_position_conflict', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
    });
  });

  it('surfaces load_position_conflict: true when the RPC reports a conflict', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: { load_position_id: 'pos-1', conflict: true }, error: null });
    const { client } = buildClient({ rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    const body = await res.json();
    expect(body.load_position_conflict).toBe(true);
  });

  it('reports load_position_conflict: false when there is no conflict', async () => {
    const { client } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    const body = await res.json();
    expect(body.load_position_conflict).toBe(false);
  });

  it('a thrown check_load_position_conflict never fails the removal', async () => {
    const rpcMock = vi.fn().mockRejectedValue(new Error('boom'));
    const { client } = buildClient({ rpcMock });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.load_position_conflict).toBe(false);
  });
});
