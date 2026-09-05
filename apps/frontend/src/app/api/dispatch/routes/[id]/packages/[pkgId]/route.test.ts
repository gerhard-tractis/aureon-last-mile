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
  /**
   * spec-79 review M-2: rows the sibling-dispatch check (see
   * `route.ts`'s scoping of the packages revert) resolves with — a live
   * dispatch for the SAME order on a DIFFERENT route. Empty by default
   * ("no sibling", the ordinary case), so every existing test keeps its
   * current behaviour without having to know this query exists.
   */
  siblingDispatchRows?: unknown[];
  siblingQueryError?: { code: string; message: string };
} = {}) {
  // Not a default parameter: {role: undefined} must mean "no role in the
  // claims", not "fall back to ops_leader" — the exact case the missing-role
  // test needs to exercise.
  const role = 'role' in opts ? opts.role : 'ops_leader';
  const { routeStatus = 'loading', dispatchFound = true, dispatchQueryError } = opts;

  // spec-79 review M-2: `.from('dispatches')` is now called up to three
  // times (lookup, sibling check, soft-delete) instead of two. Differentiated
  // by which builder method is invoked (`select` vs `update`), and by an
  // internal counter on `select` itself, so it survives regardless of how
  // many times `.from()` is called in total — a call-count-keyed mock broke
  // on every test the moment this query was added.
  let selectCallCount = 0;
  const lookupTail = {
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
  const siblingTail = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({
      data: opts.siblingQueryError ? null : (opts.siblingDispatchRows ?? []),
      error: opts.siblingQueryError ?? null,
    }),
  };
  lookupTail.eq.mockReturnValue(lookupTail);
  lookupTail.is.mockReturnValue(lookupTail);
  siblingTail.eq.mockReturnValue(siblingTail);
  siblingTail.in.mockReturnValue(siblingTail);
  siblingTail.neq.mockReturnValue(siblingTail);

  const dispatchUpdateSpy = vi.fn();
  dispatchUpdateSpy.mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });

  const dispatchesTableMock = {
    select: vi.fn(() => {
      selectCallCount += 1;
      return selectCallCount === 1 ? lookupTail : siblingTail;
    }),
    update: dispatchUpdateSpy,
  };

  // spec-79 F4: the third filter widened from `.eq('status', 'en_carga')` to
  // `.in('status', LOADED_ON_TRUCK_STATUSES)`.
  // spec-79 review F6: `.is('deleted_at', null)` re-asserted after the
  // status `.in()`, so the chain gets one level deeper.
  const packagesIsSpy = vi.fn().mockResolvedValue({ error: null });
  const packagesInSpy = vi.fn().mockReturnValue({ is: packagesIsSpy });
  const packagesUpdateSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ in: packagesInSpy }),
    }),
  });
  const packagesChain = { update: packagesUpdateSpy };

  const auditInsertSpy = vi.fn().mockReturnValue({ then: vi.fn((resolve: () => null) => resolve()) });
  const auditChain = { insert: auditInsertSpy };

  const fromMock = vi.fn((table: string) => {
    if (table === 'dispatches') return dispatchesTableMock;
    if (table === 'packages') return packagesChain;
    if (table === 'audit_logs') return auditChain;
    return dispatchesTableMock;
  });

  const rpcMock = opts.rpcMock ?? vi.fn().mockResolvedValue({ data: { conflict: false }, error: null });

  return {
    client: {
      auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
      from: fromMock,
      rpc: rpcMock,
    },
    dispatchUpdateSpy,
    siblingSelectSpy: dispatchesTableMock.select,
    siblingTail,
    packagesUpdateSpy,
    packagesInSpy,
    packagesIsSpy,
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

  it('resets the package to sectorizado, not asignado, and clears the per-box load fact', async () => {
    const { client, packagesUpdateSpy } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    // spec-79 review F7: loaded_at/loaded_by/load_inferred are reset here
    // too — leaving loaded_at set made the box permanently unloadable if
    // re-planned onto another route (scan-validator.ts's ALREADY_STAGED
    // check reads loaded_at && !load_inferred).
    expect(packagesUpdateSpy).toHaveBeenCalledWith({
      status: 'sectorizado',
      loaded_at: null,
      loaded_by: null,
      load_inferred: false,
      // spec-79 BLOCKER: loaded_route_id reset alongside the rest of the
      // per-box load fact.
      loaded_route_id: null,
    });
  });

  /**
   * spec-79 F4: widened from `.eq('status', 'en_carga')` alone. A route can
   * legally be unsealed `loaded -> loading` (spec-70,
   * 20260825000002:255), and by then its packages already moved to
   * `listo_para_despacho` by /seal without ever moving back to `en_carga`.
   * Before this fix a package removed from such a route stranded at
   * `listo_para_despacho` with no route at all.
   *
   * spec-79 review F9: this test's title used to claim it reverted "a
   * package at listo_para_despacho" — but `buildClient()` carries no package
   * fixture at all; this handler blind-UPDATEs by `order_id` and a status
   * filter, with no per-package SELECT to fixture in a unit test. What this
   * actually proves — and all it can prove without a live DB — is that the
   * status FILTER SENT includes `listo_para_despacho`, which is the real
   * fix. Retitled to say exactly that, not more.
   */
  it('sends listo_para_despacho (not just en_carga) in the status filter of the packages revert', async () => {
    const { client, packagesInSpy, packagesIsSpy } = buildClient();
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);

    expect(packagesInSpy).toHaveBeenCalledWith('status', ['en_carga', 'listo_para_despacho']);
    // spec-79 review F6: deleted_at re-asserted after the status filter.
    expect(packagesIsSpy).toHaveBeenCalledWith('deleted_at', null);
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

  /**
   * spec-79 review M-2: `packages` carries no route linkage, so the revert
   * that used to run on `.eq('order_id', dispatch.order_id)` alone reached
   * every box of the order — including one physically loaded on a DIFFERENT
   * still-live route for the same order (permitted:
   * 20260901000001_spec74_package_load_state.sql:181-183). Scenario: order O
   * planned on routes A and B; a box is scanned onto A; a manager removes
   * O's stop from B. Without this check the box, physically on truck A, gets
   * wiped back to `sectorizado` with its load fact cleared — and A can no
   * longer seal.
   */
  it('does not revert packages when the order has a live dispatch on a different route (M-2)', async () => {
    const { client, packagesUpdateSpy, siblingSelectSpy } = buildClient({
      siblingDispatchRows: [{ order_id: 'o1' }],
    });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    expect(siblingSelectSpy).toHaveBeenCalled();
    expect(packagesUpdateSpy).not.toHaveBeenCalled();
  });

  it('still reverts packages when no other route carries a live dispatch for the order', async () => {
    const { client, packagesUpdateSpy } = buildClient({ siblingDispatchRows: [] });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    expect(packagesUpdateSpy).toHaveBeenCalled();
  });

  /**
   * spec-79 BLOCKER (coordinator addendum): corrected from "fails open" —
   * a lookup that cannot run is not evidence the box is safe to revert.
   * See dispatch-cross-route-orders.ts's header for the full reasoning.
   */
  it('fails CLOSED (does not revert) when the sibling-dispatch check itself errors, and records it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client, packagesUpdateSpy, auditInsertSpy } = buildClient({
      siblingQueryError: { code: '08006', message: 'connection reset' },
    });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await DELETE(buildRequest(), { params });
    expect(res.status).toBe(200);
    expect(packagesUpdateSpy).not.toHaveBeenCalled();
    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cross_route_lookup_failed' }),
    );
    errorSpy.mockRestore();
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
