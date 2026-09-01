import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { PATCH } from './route';
import { NextRequest } from 'next/server';

const params = Promise.resolve({ id: 'r1', blockId: 'b1' });

function buildRequest(body: unknown = { direction: 'up' }) {
  return new NextRequest('http://localhost/api/dispatch/routes/r1/blocks/b1', {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionWithRole(role: string | undefined) {
  return {
    data: {
      session: {
        user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1', role } } },
      },
    },
    error: null,
  };
}

function buildClient(opts: {
  role?: string;
  rpcError?: { code: string; message: string } | null;
} = {}) {
  const role = 'role' in opts ? opts.role : 'ops_leader';
  const rpc = vi.fn().mockResolvedValue({ data: null, error: opts.rpcError ?? null });
  return {
    client: {
      auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
      rpc,
    },
    rpc,
  };
}

describe('PATCH /api/dispatch/routes/[id]/blocks/[blockId]', () => {
  beforeEach(() => vi.mocked(createSSRClient).mockReset());

  it('401s with no session', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    const res = await PATCH(buildRequest(), { params });
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

    const res = await PATCH(buildRequest(), { params });
    expect(res.status).toBe(403);
  });

  /** Reordering the plan is a manager action, same gate as removing a stop. */
  it('403s a role outside PLAN_MANAGER_ROLES', async () => {
    const { client } = buildClient({ role: 'pickup_crew' });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest(), { params });
    expect(res.status).toBe(403);
  });

  it('400s an invalid direction value', async () => {
    const { client } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ direction: 'sideways' }), { params });
    expect(res.status).toBe(400);
  });

  it('calls move_route_block with the resolved route/block/operator ids and direction', async () => {
    const { client, rpc } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ direction: 'down' }), { params });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('move_route_block', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
      p_block_id: 'b1',
      p_direction: 'down',
    });
  });

  it('404s ROUTE_NOT_FOUND (P0002, message prefix ROUTE_NOT_FOUND) as ROUTE_NOT_FOUND', async () => {
    const { client } = buildClient({
      rpcError: { code: 'P0002', message: 'ROUTE_NOT_FOUND: route r1 for operator op-1' },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('ROUTE_NOT_FOUND');
  });

  it('404s BLOCK_NOT_FOUND (P0002, message prefix BLOCK_NOT_FOUND) as BLOCK_NOT_FOUND', async () => {
    const { client } = buildClient({
      rpcError: { code: 'P0002', message: 'BLOCK_NOT_FOUND: block b1 on route r1 for operator op-1' },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('BLOCK_NOT_FOUND');
  });

  it('409s ROUTE_SEALED (P0001, message prefix ROUTE_SEALED) as ROUTE_SEALED', async () => {
    const { client } = buildClient({
      rpcError: { code: 'P0001', message: 'ROUTE_SEALED: route r1 is dispatched ; blocks can only be reordered before loading completes' },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('ROUTE_SEALED');
  });

  /**
   * spec-72 phase 3 review item 6 (mutation-targeted): the operator id sent
   * to move_route_block must always be the session's own — never anything
   * the client supplied. A mutant swapping `operatorId` for
   * `body.operator_id ?? operatorId` survived every prior test in this file
   * because none of them ever put `operator_id` in the request body; this
   * one does, with a value that must never reach the RPC call.
   */
  it('ignores an operator_id supplied in the request body — uses the session operator_id', async () => {
    const { client, rpc } = buildClient();
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ direction: 'up', operator_id: 'op-EVIL' }), { params });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('move_route_block', {
      p_route_id: 'r1',
      p_operator_id: 'op-1',
      p_block_id: 'b1',
      p_direction: 'up',
    });
  });

  it('500s an unrelated RPC failure without leaking the raw message', async () => {
    const { client } = buildClient({ rpcError: { code: 'XX000', message: 'connection reset by peer' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.message).not.toContain('connection reset by peer');
  });
});
