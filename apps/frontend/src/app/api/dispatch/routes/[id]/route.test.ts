import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { DELETE } from './route';
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
