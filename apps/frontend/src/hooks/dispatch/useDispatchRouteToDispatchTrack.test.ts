import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDispatchRouteToDispatchTrack } from './useDispatchRouteToDispatchTrack';

describe('useDispatchRouteToDispatchTrack', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('posts the real endpoint with the mapped truck/driver identifiers', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: 'Mario' });
    });

    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/dispatch/routes/route-1/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truck_identifier: 'RTHK-72', driver_identifier: 'Mario' }),
    });
  });

  it('tracks dispatching state across the call', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));
    expect(result.current.dispatching).toBe(false);

    let dispatchPromise!: Promise<boolean>;
    act(() => {
      dispatchPromise = result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });
    await waitFor(() => expect(result.current.dispatching).toBe(true));

    resolveFetch({ ok: true, json: async () => ({}) });
    await act(async () => {
      await dispatchPromise;
    });
    expect(result.current.dispatching).toBe(false);
  });

  /**
   * spec-79 M-2 (round 8 mediums). This hook used to throw
   * `new Error(json.message ?? 'Error al despachar')` and store only
   * `err.message` as a plain string, discarding `json.code` entirely — so
   * desktop's RoutePanel (`1b`) and the tablet's DispatchTabletActionBar
   * (`3a`) rendered the raw internal string for codes like
   * `DT_OUTCOME_UNKNOWN` ("The operation was aborted due to timeout")
   * instead of the humanised, code-aware copy `2j`/`2k` already have via
   * `dispatchErrorCopy` (`dispatch-review.ts`) — the whole point of that
   * code being distinct is that "DT may have accepted this" reaches the
   * operator, not an untranslated fetch/AbortSignal message.
   */
  it('M-2: maps the response code through dispatchErrorCopy instead of surfacing the raw message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'DT_OUTCOME_UNKNOWN', message: 'The operation was aborted due to timeout' }),
    });
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(ok).toBe(false);
    expect(result.current.errorInfo).not.toBeNull();
    expect(result.current.errorInfo?.primaryAction).toBe('verify');
    // The exact copy dispatchErrorCopy('DT_OUTCOME_UNKNOWN') produces — not
    // the raw fetch/timeout message the server happened to send.
    expect(result.current.errorInfo?.text).not.toBe('The operation was aborted due to timeout');
    expect(result.current.errorInfo?.text).toMatch(/DispatchTrack/);
  });

  it('returns false and sets a mapped errorInfo on a failed response with a known code, without throwing', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'VEHICLE_NOT_FOUND', message: 'Vehículo sin capacidad configurada' }),
    });
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(ok).toBe(false);
    expect(result.current.errorInfo?.primaryAction).toBeNull();
    expect(result.current.errorInfo?.text).toMatch(/camión/i);
  });

  it('falls back to the generic network-failure copy when the failure carries no response at all', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue({});
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    await act(async () => {
      await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(result.current.errorInfo).not.toBeNull();
    expect(result.current.errorInfo?.primaryAction).toBe('verify');
  });

  it('clears errorInfo at the start of a new dispatch attempt', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ code: 'VEHICLE_NOT_FOUND' }),
    });
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    await act(async () => {
      await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });
    expect(result.current.errorInfo).not.toBeNull();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await act(async () => {
      await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });
    expect(result.current.errorInfo).toBeNull();
  });
});
