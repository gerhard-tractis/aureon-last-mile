import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetSession, mockSealLoadPosition } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSealLoadPosition: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
  })),
}));

vi.mock('@/lib/dispatch/seal-load-position', () => ({
  sealLoadPosition: mockSealLoadPosition,
}));

import { POST } from './route';

function makeReq(body: unknown = { positionCode: "POS'04" }) {
  return new NextRequest('http://localhost/api/dispatch/load-positions/seal', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: 'u-1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
    error: null,
  });
});

describe('POST /api/dispatch/load-positions/seal', () => {
  it('401s with no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(mockSealLoadPosition).not.toHaveBeenCalled();
  });

  it('403s with no operator claim', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1', app_metadata: { claims: {} } } } },
      error: null,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
  });

  it('400s on a malformed body', async () => {
    const res = await POST(makeReq({ positionCode: '' }));
    expect(res.status).toBe(400);
    expect(mockSealLoadPosition).not.toHaveBeenCalled();
  });

  it('seals the route occupying the scanned position', async () => {
    mockSealLoadPosition.mockResolvedValue({
      ok: true,
      already_sealed: false,
      sealed_stops: 4,
      orders_closed: 4,
      positionCode: 'POS-04',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      already_sealed: false,
      sealed_stops: 4,
      orders_closed: 4,
      position_code: 'POS-04',
    });
    expect(mockSealLoadPosition).toHaveBeenCalledWith(expect.anything(), {
      positionCode: "POS'04",
      operatorId: 'op-1',
    });
  });

  /** The button is at a dock and gets double-tapped, same as route-level /seal. */
  it('is idempotent on an already-sealed position', async () => {
    mockSealLoadPosition.mockResolvedValue({ ok: true, already_sealed: true, positionCode: 'POS-04' });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, already_sealed: true, position_code: 'POS-04' });
  });

  it('422s AMBIGUOUS_POSITION, matching the staging scan\'s treatment', async () => {
    mockSealLoadPosition.mockResolvedValue({
      ok: false,
      status: 422,
      code: 'AMBIGUOUS_POSITION',
      message: 'El código escaneado coincide con más de una posición (POS-01, POS01).',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('AMBIGUOUS_POSITION');
  });

  it('422s POSITION_NOT_OCCUPIED for a position with no live route', async () => {
    mockSealLoadPosition.mockResolvedValue({
      ok: false,
      status: 422,
      code: 'POSITION_NOT_OCCUPIED',
      message: 'La posición POS-04 no tiene una ruta asignada',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('POSITION_NOT_OCCUPIED');
  });

  /** Position-level analogue of the route-level UNSEALED_STOPS refusal. */
  it('409s UNSEALED_STOPS, naming the pending orders, when any dispatch on the route is still planned', async () => {
    mockSealLoadPosition.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'UNSEALED_STOPS',
      pending_count: 2,
      pending: ['ORD-1', 'ORD-2'],
      message:
        'Faltan 2 parada(s) por estibar. Escanéalas o pide a un responsable que las quite de la planificación.',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('UNSEALED_STOPS');
    expect(body.pending_count).toBe(2);
    expect(body.pending).toEqual(['ORD-1', 'ORD-2']);
  });

  it('409s ROUTE_NOT_OPEN when the occupying route is already dispatched', async () => {
    mockSealLoadPosition.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'ROUTE_NOT_OPEN',
      message: 'La ruta no se puede cerrar en estado dispatched',
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ROUTE_NOT_OPEN');
  });
});
