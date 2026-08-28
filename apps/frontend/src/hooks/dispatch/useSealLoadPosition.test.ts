import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSealLoadPosition } from './useSealLoadPosition';

describe('useSealLoadPosition', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the scanned code and reports a successful seal', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, already_sealed: false, sealed_stops: 3, orders_closed: 3, position_code: 'POS-04' }),
    });

    const { result } = renderHook(() => useSealLoadPosition());

    let outcome: Awaited<ReturnType<typeof result.current.sealPosition>> | undefined;
    await act(async () => {
      outcome = await result.current.sealPosition("POS'04");
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/load-positions/seal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ positionCode: "POS'04" }),
      }),
    );
    expect(outcome).toEqual({
      ok: true,
      positionCode: 'POS-04',
      alreadySealed: false,
      sealedStops: 3,
    });
  });

  it('reports already_sealed for a repeat tap — idempotent, no error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, already_sealed: true, position_code: 'POS-04' }),
    });

    const { result } = renderHook(() => useSealLoadPosition());
    let outcome;
    await act(async () => {
      outcome = await result.current.sealPosition('POS-04');
    });
    expect(outcome).toEqual({ ok: true, positionCode: 'POS-04', alreadySealed: true, sealedStops: undefined });
  });

  it('surfaces the server refusal message (e.g. UNSEALED_STOPS) on failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'UNSEALED_STOPS',
        message: 'Faltan 2 parada(s) por estibar.',
      }),
    });

    const { result } = renderHook(() => useSealLoadPosition());
    let outcome;
    await act(async () => {
      outcome = await result.current.sealPosition('POS-04');
    });
    expect(outcome).toEqual({ ok: false, message: 'Faltan 2 parada(s) por estibar.' });
  });

  it('falls back to a generic message on a network error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSealLoadPosition());
    let outcome;
    await act(async () => {
      outcome = await result.current.sealPosition('POS-04');
    });
    expect(outcome).toEqual({ ok: false, message: 'Error al sellar — intenta de nuevo' });
  });
});
