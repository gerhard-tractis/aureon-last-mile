import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSealRoute } from './useSealRoute';

describe('useSealRoute', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to /seal with no body on an unforced close', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sealed_stops: 148, orders_closed: 60 }),
    });
    const { result } = renderHook(() => useSealRoute());

    let outcome;
    await act(async () => {
      outcome = await result.current.seal('route-1');
    });

    expect(fetch).toHaveBeenCalledWith('/api/dispatch/routes/route-1/seal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(outcome).toEqual({ ok: true, sealedStops: 148, ordersClosed: 60, forced: undefined });
  });

  it('carries the force body — reason, note, item 8 setup', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sealed_stops: 124,
        orders_closed: 40,
        forced: { reason_code: 'turno_terminado', released_count: 24 },
      }),
    });
    const { result } = renderHook(() => useSealRoute());

    let outcome;
    await act(async () => {
      outcome = await result.current.seal('route-1', {
        force: true,
        reason_code: 'turno_terminado',
        note: 'ORD-9: no estaba',
      });
    });

    expect(fetch).toHaveBeenCalledWith('/api/dispatch/routes/route-1/seal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, reason_code: 'turno_terminado', note: 'ORD-9: no estaba' }),
    });
    expect(outcome).toEqual({
      ok: true,
      sealedStops: 124,
      ordersClosed: 40,
      forced: { reason_code: 'turno_terminado', released_count: 24 },
    });
  });

  it('surfaces a refusal (e.g. FORCE_REASON_REQUIRED) instead of throwing', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'FORCE_REASON_REQUIRED', message: 'Se requiere un motivo' }),
    });
    const { result } = renderHook(() => useSealRoute());

    let outcome;
    await act(async () => {
      outcome = await result.current.seal('route-1', { force: true });
    });

    expect(outcome).toEqual({ ok: false, code: 'FORCE_REASON_REQUIRED', message: 'Se requiere un motivo' });
  });

  it('a network failure resolves to a refusal, never throws', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSealRoute());

    let outcome;
    await act(async () => {
      outcome = await result.current.seal('route-1');
    });

    expect(outcome).toEqual({ ok: false, code: null, message: 'Error al cerrar la ruta — intenta de nuevo' });
  });

  it('tracks isSealing across the call', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useSealRoute());
    expect(result.current.isSealing).toBe(false);

    let sealPromise: Promise<unknown>;
    act(() => {
      sealPromise = result.current.seal('route-1');
    });
    expect(result.current.isSealing).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ ok: true, sealed_stops: 1, orders_closed: 1 }) });
      await sealPromise;
    });
    expect(result.current.isSealing).toBe(false);
  });
});
