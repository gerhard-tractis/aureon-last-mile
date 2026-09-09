import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { GET } from './route';

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
  drivers?: unknown[];
  driversError?: { message: string } | null;
}) {
  const role = 'role' in opts ? opts.role : 'admin';
  const driversChain = {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: opts.drivers ?? [], error: opts.driversError ?? null }),
  };
  return {
    auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
    from: vi.fn(() => driversChain),
  };
}

describe('GET /api/admin/drivers', () => {
  beforeEach(() => vi.mocked(createSSRClient).mockReset());

  it('401s with no session', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403s a role that is neither admin nor operations_manager', async () => {
    const client = buildClient({ role: 'pickup_crew' });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it.each(['admin', 'operations_manager'])('200s with the driver list for role %s', async (role) => {
    const drivers = [
      { id: 'd1', operator_id: 'op-1', full_name: 'Driver Uno', phone: '+56911111101', rut: null, fleet_type: 'own', status: 'active', user_id: null, users: null },
    ];
    const client = buildClient({ role, drivers });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(drivers);
    expect(client.from).toHaveBeenCalledWith('drivers');
  });

  it('500s on a database error', async () => {
    const client = buildClient({ role: 'admin', driversError: { message: 'db exploded' } });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
