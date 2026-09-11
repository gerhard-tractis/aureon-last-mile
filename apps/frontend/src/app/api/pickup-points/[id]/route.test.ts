import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));

import { createSSRClient } from '@/lib/supabase/server';
import { PUT } from './route';

/**
 * spec-83 fase 2. Round 2 asked for three tests by name (401, a cutoff that
 * actually clears, a merge that does not destroy the rest of sla_config)
 * plus format rejection and the omitted-key case — 5, not 3. Round 3 added
 * the 403 gate and a route-level (not just form-schema-level) rejection of
 * a garbage `operating_hours` time.
 */

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

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof PUT>[0];
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/**
 * `.select().eq().is().single()` is used twice per PUT: once for the
 * existence/current-row check, once after `.update(...)` to return the
 * result. Both chains look identical from the mock's point of view, so the
 * two resolved values are told apart by call order on `.single()`.
 */
function buildClient(opts: {
  role?: string;
  existing?: unknown;
  updated?: unknown;
  updateError?: { message: string } | null;
}) {
  const role = 'role' in opts ? opts.role : 'admin';
  let singleCalls = 0;
  const updateSpy = vi.fn().mockReturnThis();
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    update: updateSpy,
    single: vi.fn(() => {
      singleCalls += 1;
      if (singleCalls === 1) {
        return Promise.resolve({
          data: opts.existing ?? { id: 'pp1', sla_config: {} },
          error: null,
        });
      }
      return Promise.resolve({
        data: opts.updated ?? { id: 'pp1' },
        error: opts.updateError ?? null,
      });
    }),
  };
  return {
    auth: { getSession: vi.fn().mockResolvedValue(sessionWithRole(role)) },
    from: vi.fn(() => chain),
    updateSpy,
  };
}

describe('PUT /api/pickup-points/[id]', () => {
  beforeEach(() => vi.mocked(createSSRClient).mockReset());

  it('401s with no session', async () => {
    vi.mocked(createSSRClient).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    } as never);

    const res = await PUT(makeRequest({ sla_config: { pickup_cutoff_time: '18:00' } }), makeParams('pp1'));
    expect(res.status).toBe(401);
  });

  it('403s a role that is neither admin nor operations_manager', async () => {
    // Round 3 nit: the gate exists (`userRole !== 'admin' && userRole !==
    // 'operations_manager'`) and works, but nothing asserted it.
    const client = buildClient({ role: 'pickup_crew' });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PUT(makeRequest({ name: 'x' }), makeParams('pp1'));

    expect(res.status).toBe(403);
    expect(client.updateSpy).not.toHaveBeenCalled();
  });

  it('400s a malformed cutoff instead of persisting it literally', async () => {
    const client = buildClient({});
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PUT(makeRequest({ sla_config: { pickup_cutoff_time: 'banana' } }), makeParams('pp1'));

    expect(res.status).toBe(400);
    expect(client.updateSpy).not.toHaveBeenCalled();
  });

  it('400s a garbage operating_hours time at the route, not just at the form schema', async () => {
    // Round 3 nit: the route DOES reject this (pickupPointApiSchemas.ts's
    // shared regex), but until now only the FORM schema's own unit tests
    // demonstrated it — nothing exercised the route directly.
    const client = buildClient({});
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PUT(
      makeRequest({ pickup_locations: [{ operating_hours: { start: 'banana' } }] }),
      makeParams('pp1'),
    );

    expect(res.status).toBe(400);
    expect(client.updateSpy).not.toHaveBeenCalled();
  });

  it('clears a previously-set cutoff when sent as null, without touching the rest of sla_config', async () => {
    // The row already carries other sla_config keys this form never shows
    // (20260318000004:64-66's documented shape: max_delivery_hours,
    // delivery_window, penalty_per_failure_clp) — an update that overwrites
    // the whole object rather than merging would silently erase them.
    const client = buildClient({
      existing: {
        id: 'pp1',
        sla_config: { max_delivery_hours: 24, pickup_cutoff_time: '12:30', delivery_window: '09-18' },
      },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PUT(makeRequest({ sla_config: { pickup_cutoff_time: null } }), makeParams('pp1'));

    expect(res.status).toBe(200);
    expect(client.updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sla_config: { max_delivery_hours: 24, pickup_cutoff_time: null, delivery_window: '09-18' },
      }),
    );
  });

  it('leaves sla_config completely untouched when the request omits it', async () => {
    // Distinguishes "sla_config key not sent at all" (editing the name only,
    // say) from "sla_config sent with an explicit null" (B2's clear). Only
    // the latter should produce an sla_config key in the update payload.
    const client = buildClient({
      existing: { id: 'pp1', sla_config: { pickup_cutoff_time: '12:30' } },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PUT(makeRequest({ name: 'Bodega Renombrada' }), makeParams('pp1'));

    expect(res.status).toBe(200);
    expect(client.updateSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ sla_config: expect.anything() }),
    );
  });

  it('sets a new cutoff while preserving unrelated sla_config keys', async () => {
    const client = buildClient({
      existing: { id: 'pp1', sla_config: { max_delivery_hours: 24 } },
    });
    vi.mocked(createSSRClient).mockResolvedValue(client as never);

    const res = await PUT(makeRequest({ sla_config: { pickup_cutoff_time: '18:00' } }), makeParams('pp1'));

    expect(res.status).toBe(200);
    expect(client.updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sla_config: { max_delivery_hours: 24, pickup_cutoff_time: '18:00' },
      }),
    );
  });
});
