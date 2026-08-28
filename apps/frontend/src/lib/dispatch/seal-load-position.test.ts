import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sealLoadPosition } from './seal-load-position';

/**
 * `sealLoadPosition` composes `resolvePositionAndRoute` (mocked here — it
 * has its own suite in `load-position-resolve.test.ts`-equivalent coverage
 * inside `load-position-scan.test.ts`) with `sealRoute` (mocked here too —
 * its full guard/write behaviour is covered by
 * `routes/[id]/seal/route.test.ts` against the same function). This suite
 * is only about the wiring: which scanned code resolves to which route,
 * and that a position-level refusal never reaches `sealRoute` at all.
 */
const mockResolvePositionAndRoute = vi.hoisted(() => vi.fn());
const mockSealRoute = vi.hoisted(() => vi.fn());

vi.mock('./load-position-resolve', () => ({
  resolvePositionAndRoute: mockResolvePositionAndRoute,
}));
vi.mock('./seal-route', () => ({
  sealRoute: mockSealRoute,
}));

const client = {} as never;
const input = { positionCode: "POS'04", operatorId: 'op-1' };

beforeEach(() => vi.clearAllMocks());

describe('sealLoadPosition', () => {
  it('resolves the position, then seals the route occupying it', async () => {
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: true,
      position: { id: 'lp-1', code: 'POS-04' },
      routeId: 'route-1',
    });
    mockSealRoute.mockResolvedValue({ ok: true, already_sealed: false, sealed_stops: 3, orders_closed: 3 });

    const result = await sealLoadPosition(client, input);

    expect(mockResolvePositionAndRoute).toHaveBeenCalledWith(client, {
      operatorId: 'op-1',
      scannedCode: "POS'04",
    });
    expect(mockSealRoute).toHaveBeenCalledWith(client, { routeId: 'route-1', operatorId: 'op-1' });
    expect(result).toEqual({
      ok: true,
      already_sealed: false,
      sealed_stops: 3,
      orders_closed: 3,
      positionCode: 'POS-04',
    });
  });

  // Renamed (review fix #4) — this only proves already_sealed is forwarded;
  // sealRoute is mocked here so it cannot observe writes. The real no-write
  // assertion is `routes/[id]/seal/route.test.ts:131`.
  it('forwards already_sealed for an already-sealed position', async () => {
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: true,
      position: { id: 'lp-1', code: 'POS-04' },
      routeId: 'route-1',
    });
    mockSealRoute.mockResolvedValue({ ok: true, already_sealed: true });

    const result = await sealLoadPosition(client, input);
    expect(result).toEqual({ ok: true, already_sealed: true, positionCode: 'POS-04' });
  });

  it('refuses (AMBIGUOUS_POSITION) without ever calling sealRoute, same as the staging scan', async () => {
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: false,
      code: 'AMBIGUOUS_POSITION',
      message: 'El código escaneado coincide con más de una posición (POS-01, POS01).',
    });

    const result = await sealLoadPosition(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AMBIGUOUS_POSITION');
    expect(mockSealRoute).not.toHaveBeenCalled();
  });

  it('refuses POSITION_NOT_OCCUPIED without ever calling sealRoute', async () => {
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: false,
      code: 'POSITION_NOT_OCCUPIED',
      message: 'La posición POS-04 no tiene una ruta asignada',
    });

    const result = await sealLoadPosition(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POSITION_NOT_OCCUPIED');
    expect(mockSealRoute).not.toHaveBeenCalled();
  });

  it('passes through UNSEALED_STOPS from sealRoute — the position-level analogue of the route refusal', async () => {
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: true,
      position: { id: 'lp-1', code: 'POS-04' },
      routeId: 'route-1',
    });
    mockSealRoute.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'UNSEALED_STOPS',
      pending_count: 2,
      pending: ['ORD-1', 'ORD-2'],
      message: 'Faltan 2 parada(s) por estibar. Escanéalas o pide a un responsable que las quite de la planificación.',
    });

    const result = await sealLoadPosition(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSEALED_STOPS');
      expect(result.pending_count).toBe(2);
      expect(result.pending).toEqual(['ORD-1', 'ORD-2']);
    }
  });

  it('passes through POSITION_NOT_FOUND from resolution', async () => {
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: false,
      code: 'POSITION_NOT_FOUND',
      message: 'Posición no encontrada',
    });
    const result = await sealLoadPosition(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POSITION_NOT_FOUND');
    expect(mockSealRoute).not.toHaveBeenCalled();
  });

  // Review item 2 — a query that failed to run is not the same fact as a
  // resolution refusal (POSITION_NOT_FOUND etc.): it must be a 500, not the
  // 422 those get, and the raw driver text must not reach the client.
  it('reports QUERY_FAILED as 500 with a generic message, not the raw driver text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolvePositionAndRoute.mockResolvedValue({
      ok: false,
      code: 'QUERY_FAILED',
      message: 'No se pudo validar la posición: connection terminated unexpectedly',
    });

    const result = await sealLoadPosition(client, input);
    expect(result).toEqual({
      ok: false,
      status: 500,
      code: 'QUERY_FAILED',
      message: 'No se pudo validar la posición',
    });
    expect(mockSealRoute).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('connection terminated unexpectedly'),
    );
    consoleError.mockRestore();
  });
});
