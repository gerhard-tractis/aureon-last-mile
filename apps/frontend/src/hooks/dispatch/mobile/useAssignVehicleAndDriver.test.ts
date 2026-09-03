import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssignVehicleAndDriver } from './useAssignVehicleAndDriver';

describe('useAssignVehicleAndDriver', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('PATCHes the route with truck_identifier and driver_name', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, vehicle_id: 'veh-1', external_vehicle_id: 'RTHK-72', driver_name: 'Mario' }),
    });

    const { result } = renderHook(() => useAssignVehicleAndDriver());

    let outcome: Awaited<ReturnType<typeof result.current.assign>> | undefined;
    await act(async () => {
      outcome = await result.current.assign('route-1', 'RTHK-72', 'Mario');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/route-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ truck_identifier: 'RTHK-72', driver_name: 'Mario' }),
      }),
    );
    expect(outcome).toEqual({ ok: true, vehicleId: 'veh-1', driverName: 'Mario' });
  });

  it('sends null driver_name when none was entered', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, vehicle_id: 'veh-1', driver_name: null }),
    });
    const { result } = renderHook(() => useAssignVehicleAndDriver());
    await act(async () => {
      await result.current.assign('route-1', 'RTHK-72', '');
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/route-1',
      expect.objectContaining({ body: JSON.stringify({ truck_identifier: 'RTHK-72', driver_name: null }) }),
    );
  });

  it('surfaces a blocked-vehicle refusal (409) with its message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'VEHICLE_ALREADY_ASSIGNED_TODAY', message: 'Este camión ya lleva otra ruta hoy (A3F91B2C)' }),
    });
    const { result } = renderHook(() => useAssignVehicleAndDriver());
    let outcome;
    await act(async () => {
      outcome = await result.current.assign('route-1', 'RTHK-72', null);
    });
    expect(outcome).toEqual({
      ok: false,
      message: 'Este camión ya lleva otra ruta hoy (A3F91B2C)',
      code: 'VEHICLE_ALREADY_ASSIGNED_TODAY',
    });
  });

  it('reports a network failure without throwing', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useAssignVehicleAndDriver());
    let outcome;
    await act(async () => {
      outcome = await result.current.assign('route-1', 'RTHK-72', null);
    });
    expect(outcome).toEqual({ ok: false, message: 'Error al asignar — intenta de nuevo', code: null });
  });

  it('tracks isAssigning while the request is in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );
    const { result } = renderHook(() => useAssignVehicleAndDriver());
    expect(result.current.isAssigning).toBe(false);

    let assignPromise: Promise<unknown>;
    act(() => {
      assignPromise = result.current.assign('route-1', 'RTHK-72', null);
    });
    expect(result.current.isAssigning).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ ok: true, vehicle_id: 'veh-1', driver_name: null }) });
      await assignPromise;
    });
    expect(result.current.isAssigning).toBe(false);
  });
});
