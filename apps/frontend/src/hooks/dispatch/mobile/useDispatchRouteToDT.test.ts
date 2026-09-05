import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDispatchRouteToDT } from './useDispatchRouteToDT';

describe('useDispatchRouteToDT', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts truck_identifier/driver_identifier and reports every field the endpoint returns', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, external_route_id: 'DT-164972', packages_dispatched: 148 }),
    });
    const { result } = renderHook(() => useDispatchRouteToDT());

    let outcome;
    await act(async () => {
      outcome = await result.current.dispatch('route-1', { truckIdentifier: 'RTHK-72', driverIdentifier: 'Mario' });
    });

    expect(fetch).toHaveBeenCalledWith('/api/dispatch/routes/route-1/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truck_identifier: 'RTHK-72', driver_identifier: 'Mario' }),
    });
    expect(outcome).toEqual({ ok: true, externalRouteId: 'DT-164972', packagesDispatched: 148 });
  });

  it('surfaces the server code distinctly — never flattens it to a single message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'DT_ACCEPTED_LOCAL_FAILED', external_route_id: 'DT-9', message: 'x' }),
    });
    const { result } = renderHook(() => useDispatchRouteToDT());

    let outcome;
    await act(async () => {
      outcome = await result.current.dispatch('route-1', { truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'DT_ACCEPTED_LOCAL_FAILED',
      message: 'x',
      externalRouteId: 'DT-9',
    });
  });

  it('a network failure resolves to a refusal, never throws', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDispatchRouteToDT());

    let outcome;
    await act(async () => {
      outcome = await result.current.dispatch('route-1', { truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(outcome).toEqual({ ok: false, code: null, message: 'Error de red al despachar — intentá de nuevo' });
  });

  it('tracks isDispatching across the call', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useDispatchRouteToDT());
    expect(result.current.isDispatching).toBe(false);

    let dispatchPromise!: Promise<unknown>;
    act(() => {
      dispatchPromise = result.current.dispatch('route-1', { truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });
    await waitFor(() => expect(result.current.isDispatching).toBe(true));

    resolveFetch({ ok: true, json: async () => ({ ok: true, external_route_id: 'DT-1', packages_dispatched: 1 }) });
    await act(async () => {
      await dispatchPromise;
    });
    expect(result.current.isDispatching).toBe(false);
  });

  it('item 12 — a second call while the first is still in flight never reaches fetch a second time', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useDispatchRouteToDT());

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.dispatch('route-1', { truckIdentifier: 'RTHK-72', driverIdentifier: null });
      second = result.current.dispatch('route-1', { truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, json: async () => ({ ok: true, external_route_id: 'DT-1', packages_dispatched: 1 }) });
    let firstOutcome, secondOutcome;
    await act(async () => {
      [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(firstOutcome).toEqual({ ok: true, externalRouteId: 'DT-1', packagesDispatched: 1 });
    expect(secondOutcome).toEqual({ ok: false, code: null, message: 'Ya se está despachando' });
  });
});
