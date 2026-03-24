import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(),
}));

import { createSSRClient } from '@/lib/supabase/server';
import { POST } from '@/app/api/dispatch/routes/[id]/close/route';
import { NextRequest } from 'next/server';

function buildRequest() {
  return new NextRequest('http://localhost/api/dispatch/routes/route-1/close', { method: 'POST' });
}

/**
 * Close route handler call order:
 *  1. supabase.from('routes').select().eq().eq().is().single()
 *  2. supabase.from('dispatches').select().eq().eq().is()
 *  3. supabase.from('packages').update().eq().eq().in()   (only when orderIds.length > 0)
 */
function mockSupabase(routeData: { id: string; status: string; planned_stops: number } = {
  id: 'route-1',
  status: 'draft',
  planned_stops: 3,
}) {
  const routeChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: routeData, error: null }),
  };

  const dispatchesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: [{ order_id: 'o1' }], error: null }),
  };

  // packages: .update().eq().eq().in()
  const packagesIn = vi.fn().mockResolvedValue({ data: null, error: null });
  const packagesChain = {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: packagesIn,
        }),
      }),
    }),
  };

  const fromMock = vi.fn()
    .mockReturnValueOnce(routeChain)      // routes select
    .mockReturnValueOnce(dispatchesChain) // dispatches select
    .mockReturnValueOnce(packagesChain);  // packages update

  const client = {
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
  (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

describe('POST /routes/[id]/close', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 when no session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      },
    });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when operator_id is missing from session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              user: { id: 'u1', app_metadata: { claims: {} } },
            },
          },
          error: null,
        }),
      },
    });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 when route is not found', async () => {
    const routeChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    };
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValueOnce(routeChain),
    };
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 409 when route is not in draft status', async () => {
    mockSupabase({ id: 'route-1', status: 'planned', planned_stops: 3 });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('INVALID_STATE');
  });

  it('returns 422 when route has zero planned_stops', async () => {
    mockSupabase({ id: 'route-1', status: 'draft', planned_stops: 0 });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('EMPTY_ROUTE');
  });

  it('returns 200 and closes route successfully', async () => {
    mockSupabase({ id: 'route-1', status: 'draft', planned_stops: 3 });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.packages_closed).toBe(1);
  });
});
