import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { POST } from './route';
import { NextRequest } from 'next/server';

const params = Promise.resolve({ id: 'r-receiving' });

const validBody = { donor_route_id: 'dddddddd-0000-4000-8000-0000000000d1', comuna_id: 'cccccccc-0000-4000-8000-0000000000c1', reason: 'route R under-filled' };

function buildRequest(body: unknown = validBody) {
  return new NextRequest('http://localhost/api/dispatch/routes/r-receiving/topup/accept', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
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
  const rpc = vi.fn().mockResolvedValue({ data: opts.rpcData ?? { receiving_route_id: 'r-receiving' }, error: opts.rpcError ?? null });
  return {
    client: { auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) }, rpc },
    rpc,
  };
}

describe('POST /api/dispatch/routes/[id]/topup/accept', () => {
  beforeEach(() => vi.mocked(createSSRClient).mockReset());

  it('401s with no session', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    const res = await POST(buildRequest(), { params });
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

    const res = await POST(buildRequest(), { params });
    expect(res.status).toBe(403);
  });

  /** Rule 6 / spec-70 Decision 3: accepting a top-up shapes the plan same as removal — manager only. */
  it('403s a role outside PLAN_MANAGER_ROLES', async () => {
    const { client } = buildClient({ role: 'warehouse_staff' });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    expect(res.status).toBe(403);
  });

  it('400s a body missing donor_route_id', async () => {
    const { client } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest({ comuna_id: 'cccccccc-0000-4000-8000-0000000000c1', reason: 'x' }), { params });
    expect(res.status).toBe(400);
  });

  it('400s a body missing reason', async () => {
    const { client } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest({ donor_route_id: 'dddddddd-0000-4000-8000-0000000000d1', comuna_id: 'cccccccc-0000-4000-8000-0000000000c1' }), { params });
    expect(res.status).toBe(400);
  });

  it('400s a blank reason (whitespace only)', async () => {
    const { client } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest({ ...validBody, reason: '   ' }), { params });
    expect(res.status).toBe(400);
  });

  it('calls accept_topup_block with the receiving route id from the URL, not the body', async () => {
    const { client, rpc } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('accept_topup_block', {
      p_receiving_route_id: 'r-receiving',
      p_donor_route_id: 'dddddddd-0000-4000-8000-0000000000d1',
      p_comuna_id: 'cccccccc-0000-4000-8000-0000000000c1',
      p_operator_id: 'op-1',
      p_user_id: 'u1',
      p_reason: 'route R under-filled',
    });
  });

  /**
   * Mutation-targeted, mirroring blocks/[blockId] route.test.ts's own
   * equivalent test: the operator id sent to the RPC must always be the
   * session's own — never anything the client supplied in the body.
   */
  it('ignores an operator_id supplied in the request body — uses the session operator_id', async () => {
    const { client, rpc } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest({ ...validBody, operator_id: 'op-EVIL' }), { params });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('accept_topup_block', expect.objectContaining({ p_operator_id: 'op-1' }));
  });

  it('404s ROUTE_NOT_FOUND as ROUTE_NOT_FOUND', async () => {
    const { client } = buildClient({ rpcError: { code: 'P0002', message: 'ROUTE_NOT_FOUND: receiving route r-receiving for operator op-1' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('ROUTE_NOT_FOUND');
  });

  it('404s BLOCK_NOT_FOUND as BLOCK_NOT_FOUND', async () => {
    const { client } = buildClient({ rpcError: { code: 'P0002', message: 'BLOCK_NOT_FOUND: no live block for comuna cccccccc-0000-4000-8000-0000000000c1 on donor route dddddddd-0000-4000-8000-0000000000d1' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('BLOCK_NOT_FOUND');
  });

  const p0001Cases: Array<{ prefix: string; message: string }> = [
    { prefix: 'DONOR_ROUTE_NOT_RAIDABLE', message: 'DONOR_ROUTE_NOT_RAIDABLE: donor route dddddddd-0000-4000-8000-0000000000d1 is loaded' },
    { prefix: 'RECEIVING_ROUTE_NOT_LOADABLE', message: 'RECEIVING_ROUTE_NOT_LOADABLE: receiving route r-receiving is dispatched' },
    { prefix: 'ALREADY_HAS_TOPUP', message: 'ALREADY_HAS_TOPUP: receiving route r-receiving has already accepted a borrowed block' },
    { prefix: 'AT_MAX_DROPS', message: 'AT_MAX_DROPS: receiving route r-receiving is already at its drop cap (10)' },
    { prefix: 'NOT_ADJACENT', message: 'NOT_ADJACENT: donor block not adjacent' },
    { prefix: 'OVER_TOPUP_CAP', message: 'OVER_TOPUP_CAP: block has 5 packages, cap is 2' },
    // Review fix (Decision 5.5).
    { prefix: 'BLOCK_ALREADY_STAGED', message: 'BLOCK_ALREADY_STAGED: block (route d1, comuna c1) is already loading onto its own truck and cannot be topped up away' },
  ];

  for (const { prefix, message } of p0001Cases) {
    it(`409s ${prefix} as ${prefix}`, async () => {
      const { client } = buildClient({ rpcError: { code: 'P0001', message } });
      vi.mocked(createSSRClient).mockResolvedValue(client as never);

      const res = await POST(buildRequest(), { params });
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe(prefix);
    });
  }

  it('400s REASON_REQUIRED', async () => {
    const { client } = buildClient({ rpcError: { code: '22023', message: 'REASON_REQUIRED: a reason is required to move a block off its donor route' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe('REASON_REQUIRED');
  });

  // Review fix (security). The RPC is GRANT EXECUTE ... TO authenticated, so
  // it carries its own manager gate now. A 42501 coming back from it is the
  // same refusal this handler makes, reached by a caller that bypassed the
  // handler — it must read as a 403, not an opaque 500.
  it('403s a 42501 FORBIDDEN raised by the RPC itself', async () => {
    const { client } = buildClient({
      rpcError: { code: '42501', message: 'FORBIDDEN: solo un responsable puede aceptar un relleno de camion.' },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('FORBIDDEN');
  });

  it('400s INVALID_TOPUP (a route topping up from itself)', async () => {
    const { client } = buildClient({
      rpcError: { code: '22023', message: 'INVALID_TOPUP: a route cannot top up from itself' },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe('INVALID_TOPUP');
  });

  it('500s an unrelated RPC failure without leaking the raw message', async () => {
    const { client } = buildClient({ rpcError: { code: 'XX000', message: 'connection reset by peer' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await POST(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.message).not.toContain('connection reset by peer');
  });
});
