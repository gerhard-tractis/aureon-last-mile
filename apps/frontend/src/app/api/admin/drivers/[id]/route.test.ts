import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { PATCH } from './route';
import { NextRequest } from 'next/server';

const params = Promise.resolve({ id: 'd1' });

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/drivers/d1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  driverExists?: boolean;
  userExists?: boolean;
  updateError?: { code: string; message: string } | null;
  updatedDriver?: unknown;
}) {
  const role = 'role' in opts ? opts.role : 'admin';
  const driverExists = opts.driverExists ?? true;
  const userExists = opts.userExists ?? true;

  const driversSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      driverExists ? { data: { id: 'd1', operator_id: 'op-1' }, error: null } : { data: null, error: null },
    ),
  };
  const usersSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      userExists ? { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null } : { data: null, error: null },
    ),
  };
  const driversUpdateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      opts.updateError
        ? { data: null, error: opts.updateError }
        : { data: opts.updatedDriver ?? { id: 'd1', user_id: '11111111-1111-4111-8111-111111111111' }, error: null },
    ),
  };

  let driversCallCount = 0;
  const from = vi.fn((table: string) => {
    if (table === 'drivers') {
      driversCallCount += 1;
      return driversCallCount === 1 ? driversSelectChain : driversUpdateChain;
    }
    if (table === 'users') {
      return usersSelectChain;
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
    from,
  };
}

describe('PATCH /api/admin/drivers/[id]', () => {
  beforeEach(() => vi.mocked(createSSRClient).mockReset());

  it('401s with no session', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    const res = await PATCH(buildRequest({ user_id: 'u2' }), { params });
    expect(res.status).toBe(401);
  });

  it('403s a role outside admin/operations_manager', async () => {
    const client = buildClient({ role: 'pickup_crew' });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: '11111111-1111-4111-8111-111111111111' }), { params });
    expect(res.status).toBe(403);
  });

  it('400s an invalid body (user_id not a uuid, not null)', async () => {
    const client = buildClient({});
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: 'not-a-uuid' }), { params });
    expect(res.status).toBe(400);
  });

  it('404s when the driver does not exist in the caller operator', async () => {
    const client = buildClient({ driverExists: false });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: '11111111-1111-4111-8111-111111111111' }), { params });
    expect(res.status).toBe(404);
  });

  it('404s when the target user does not exist in the caller operator', async () => {
    const client = buildClient({ userExists: false });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: '11111111-1111-4111-8111-111111111111' }), { params });
    expect(res.status).toBe(404);
  });

  it('links the driver to the user and returns the updated row', async () => {
    const client = buildClient({ updatedDriver: { id: 'd1', user_id: '11111111-1111-4111-8111-111111111111' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: '11111111-1111-4111-8111-111111111111' }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: 'd1', user_id: '11111111-1111-4111-8111-111111111111' });
  });

  it('unlinks the driver when user_id is null (skips the user-exists check)', async () => {
    const client = buildClient({ updatedDriver: { id: 'd1', user_id: null } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: null }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: 'd1', user_id: null });
  });

  it('409s a unique_violation on the underlying index as DUPLICATE_USER_LINK', async () => {
    const client = buildClient({ updateError: { code: '23505', message: 'duplicate key value violates unique constraint "idx_drivers_user_id"' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PATCH(buildRequest({ user_id: '11111111-1111-4111-8111-111111111111' }), { params });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('DUPLICATE_USER_LINK');
  });
});
