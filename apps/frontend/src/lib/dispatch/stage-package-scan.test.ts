import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitPositionStageScan } from './stage-package-scan';

/**
 * spec-71 phase 3 review item 4 — `submitPositionStageScan`'s `catch` path
 * (a thrown `fetch`, e.g. offline/DNS failure rather than a non-2xx
 * response) had no test anywhere: `useQuickSortFlow.stage.test.ts` only
 * ever mocks `fetch` to resolve, never to reject. Covered directly here
 * rather than through the hook, since the hook's own suite mocks this
 * module out entirely for its other cases.
 */
describe('submitPositionStageScan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const result = await submitPositionStageScan({ packageCode: 'CTN-1', positionCode: 'POS-04' });

    expect(result).toEqual({ ok: true });
  });

  it('surfaces the server message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'La posición POS-04 no tiene una ruta asignada' }),
      }),
    );

    const result = await submitPositionStageScan({ packageCode: 'CTN-1', positionCode: 'POS-04' });

    expect(result).toEqual({ ok: false, message: 'La posición POS-04 no tiene una ruta asignada' });
  });

  it('falls back to a generic message when a non-ok response body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const result = await submitPositionStageScan({ packageCode: 'CTN-1', positionCode: 'POS-04' });

    expect(result).toEqual({ ok: false, message: 'No se pudo confirmar la posición — intente de nuevo' });
  });

  it('falls back to a generic message when the non-ok response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error('not json'); } }),
    );

    const result = await submitPositionStageScan({ packageCode: 'CTN-1', positionCode: 'POS-04' });

    expect(result).toEqual({ ok: false, message: 'No se pudo confirmar la posición — intente de nuevo' });
  });

  // The previously-uncovered branch: fetch itself rejects (network error),
  // not merely a non-2xx response.
  it('returns a network-error message when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await submitPositionStageScan({ packageCode: 'CTN-1', positionCode: 'POS-04' });

    expect(result).toEqual({ ok: false, message: 'Error de red — intente de nuevo' });
  });
});
