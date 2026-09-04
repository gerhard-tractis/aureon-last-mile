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

  it('returns false and sets error on a failed response, without throwing', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Vehículo sin capacidad configurada' }),
    });
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Vehículo sin capacidad configurada');
  });

  it('falls back to a generic error message when the failure carries none', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue({});
    const { result } = renderHook(() => useDispatchRouteToDispatchTrack('route-1'));

    await act(async () => {
      await result.current.dispatch({ truckIdentifier: 'RTHK-72', driverIdentifier: null });
    });

    expect(result.current.error).toBe('Error de DispatchTrack');
  });
});
