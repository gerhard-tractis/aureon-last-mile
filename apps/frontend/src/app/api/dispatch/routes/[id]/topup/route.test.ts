import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { GET } from './route';
import { NextRequest } from 'next/server';

const params = Promise.resolve({ id: 'r1' });

function buildRequest() {
  return new NextRequest('http://localhost/api/dispatch/routes/r1/topup', { method: 'GET' });
}

function sessionWithRole(role: string | undefined) {
  return {
    data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1', role } } } } },
    error: null,
  };
}

function buildClient(opts: {
  role?: string;
  rpcError?: { code: string; message: string } | null;
  rpcData?: unknown;
} = {}) {
  const role = 'role' in opts ? opts.role : 'ops_leader';
  const rpc = vi.fn().mockResolvedValue({ data: opts.rpcData ?? { eligible: true, candidates: [] }, error: opts.rpcError ?? null });
  return {
    client: { auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) }, rpc },
    rpc,
  };
}

describe('GET /api/dispatch/routes/[id]/topup', () => {
  beforeEach(() => vi.mocked(createSSRClient).mockReset());

  it('401s with no session', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    const res = await GET(buildRequest(), { params });
    expect(res.status).toBe(401);
  });

  it('403s without operator_id in claims', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: 'u1', app_metadata: { claims: {} } } } },
          error: null,
        }),
      },
    } as never);

    const res = await GET(buildRequest(), { params });
    expect(res.status).toBe(403);
  });

  it('403s a role outside PLAN_MANAGER_ROLES', async () => {
    const { client } = buildClient({ role: 'pickup_crew' });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET(buildRequest(), { params });
    expect(res.status).toBe(403);
  });

  it('calls get_topup_candidates with the resolved route/operator ids', async () => {
    const { client, rpc } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET(buildRequest(), { params });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('get_topup_candidates', { p_route_id: 'r1', p_operator_id: 'op-1' });
  });

  it('returns the RPC payload verbatim (candidates, eligible, reason)', async () => {
    const payload = { route_id: 'r1', eligible: false, reason: 'AT_MAX_DROPS', candidates: [] };
    const { client } = buildClient({ rpcData: payload });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET(buildRequest(), { params });
    const json = await res.json();
    expect(json).toEqual(payload);
  });

  it('404s ROUTE_NOT_FOUND (P0002, message prefix ROUTE_NOT_FOUND) as ROUTE_NOT_FOUND', async () => {
    const { client } = buildClient({ rpcError: { code: 'P0002', message: 'ROUTE_NOT_FOUND: route r1 for operator op-1' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('ROUTE_NOT_FOUND');
  });

  it('500s an unrelated RPC failure without leaking the raw message', async () => {
    const { client } = buildClient({ rpcError: { code: 'XX000', message: 'connection reset by peer' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.message).not.toContain('connection reset by peer');
  });
});
