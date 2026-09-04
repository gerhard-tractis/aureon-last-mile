import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEnRutaSnapshot } from './useEnRutaSnapshot';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

/** Builds a chainable query mock whose `.select/.eq/.in/.is/.gte` are spies
 * (so a test can assert what was passed) that all return the same chain,
 * which resolves to `result` once awaited. */
function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function routeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1', external_route_id: 'RUT-1', driver_name: 'Mario',
    vehicle_id: 'v1', status: 'in_transit', route_date: '2026-09-04',
    ...overrides,
  };
}

describe('useEnRutaSnapshot', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useEnRutaSnapshot(null, '2026-09-04'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('builds a snapshot from routes, dispatches, orders and fleet_vehicles', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) return chainable({ data: [routeRow()], error: null });
        return chainable({ data: [], error: null }); // completed cohort — none today
      }
      if (table === 'dispatches') {
        return chainable({
          data: [
            { route_id: 'r1', order_id: 'o1', status: 'delivered', completed_at: '2026-09-04T10:00:00Z', estimated_at: '2026-09-04T10:30:00Z', updated_at: '2026-09-04T10:00:00Z' },
            { route_id: 'r1', order_id: 'o2', status: 'failed', completed_at: null, estimated_at: null, updated_at: '2026-09-04T11:00:00Z' },
          ],
          error: null,
        });
      }
      if (table === 'orders') {
        return chainable({ data: [{ id: 'o1', comuna: 'Puente Alto', status: 'entregado' }, { id: 'o2', comuna: 'La Florida', status: 'en_retorno' }], error: null });
      }
      if (table === 'fleet_vehicles') {
        return chainable({ data: [{ id: 'v1', external_vehicle_id: 'ZALDUENDO' }], error: null });
      }
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const snapshot = result.current.data!;
    expect(snapshot.enRuta).toHaveLength(1);
    expect(snapshot.enRuta[0].truckIdentifier).toBe('ZALDUENDO');
    expect(snapshot.enRuta[0].comunas).toEqual(['La Florida', 'Puente Alto']);
    expect(snapshot.enRuta[0].fallidas).toBe(1);
    expect(snapshot.completadasHoy).toHaveLength(0);
    expect(snapshot.completadasSemana).toHaveLength(0);
    expect(snapshot.metrics.entregadas).toBe(1);
    expect(snapshot.metrics.fallidas).toBe(1);
    expect(snapshot.fallidasSinReingreso).toBe(1); // o2's order is still en_retorno
  });

  it('splits the completed cohort into "hoy" and "semana" — today is a filter of the week, not a second query', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) return chainable({ data: [], error: null }); // no on-road routes
        return chainable({
          data: [
            routeRow({ id: 'today', status: 'completed', route_date: '2026-09-04' }),
            routeRow({ id: 'yesterday', status: 'completed', route_date: '2026-09-03' }),
          ],
          error: null,
        });
      }
      if (table === 'dispatches') return chainable({ data: [], error: null });
      if (table === 'orders') return chainable({ data: [], error: null });
      if (table === 'fleet_vehicles') return chainable({ data: [], error: null });
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const snapshot = result.current.data!;
    expect(snapshot.completadasSemana.map((r) => r.id).sort()).toEqual(['today', 'yesterday']);
    expect(snapshot.completadasHoy.map((r) => r.id)).toEqual(['today']);
  });

  it('floors both cohorts to 7 days back — I4', async () => {
    let onRoadChain: ReturnType<typeof chainable> | undefined;
    let completedChain: ReturnType<typeof chainable> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        const c = chainable({ data: [], error: null });
        if (calls === 1) onRoadChain = c; else completedChain = c;
        return c;
      }
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(onRoadChain!.gte).toHaveBeenCalledWith('route_date', '2026-08-28');
    expect(completedChain!.gte).toHaveBeenCalledWith('route_date', '2026-08-28');
  });

  it('filters orders and fleet_vehicles by deleted_at IS NULL — I3', async () => {
    let ordersChain: ReturnType<typeof chainable> | undefined;
    let vehiclesChain: ReturnType<typeof chainable> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) return chainable({ data: [routeRow()], error: null });
        return chainable({ data: [], error: null });
      }
      if (table === 'dispatches') {
        return chainable({
          data: [{ route_id: 'r1', order_id: 'o1', status: 'pending', completed_at: null, estimated_at: null, updated_at: '2026-09-04T10:00:00Z' }],
          error: null,
        });
      }
      if (table === 'orders') {
        ordersChain = chainable({ data: [{ id: 'o1', comuna: 'Puente Alto', status: 'entregado' }], error: null });
        return ordersChain;
      }
      if (table === 'fleet_vehicles') {
        vehiclesChain = chainable({ data: [{ id: 'v1', external_vehicle_id: 'ZALDUENDO' }], error: null });
        return vehiclesChain;
      }
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(ordersChain!.is).toHaveBeenCalledWith('deleted_at', null);
    expect(vehiclesChain!.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('counts fallidasSinReingreso for parcialmente_entregado orders too, not just en_retorno — I5', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) return chainable({ data: [routeRow()], error: null });
        return chainable({ data: [], error: null });
      }
      if (table === 'dispatches') {
        return chainable({
          data: [
            { route_id: 'r1', order_id: 'o1', status: 'failed', completed_at: null, estimated_at: null, updated_at: '2026-09-04T10:00:00Z' },
            { route_id: 'r1', order_id: 'o2', status: 'failed', completed_at: null, estimated_at: null, updated_at: '2026-09-04T10:00:00Z' },
            { route_id: 'r1', order_id: 'o3', status: 'failed', completed_at: null, estimated_at: null, updated_at: '2026-09-04T10:00:00Z' },
          ],
          error: null,
        });
      }
      if (table === 'orders') {
        return chainable({
          data: [
            { id: 'o1', comuna: 'Puente Alto', status: 'en_retorno' },
            { id: 'o2', comuna: 'Puente Alto', status: 'parcialmente_entregado' },
            { id: 'o3', comuna: 'Puente Alto', status: 'entregado' }, // resolved — doesn't count
          ],
          error: null,
        });
      }
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.fallidasSinReingreso).toBe(2);
  });

  it('throws loudly instead of silently accepting a truncated response at the PostgREST row cap', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) return chainable({ data: [routeRow()], error: null });
        return chainable({ data: [], error: null });
      }
      if (table === 'dispatches') {
        // Exactly the PostgREST cap — must be treated as "likely truncated", not "that's all of it".
        const rows = Array.from({ length: 1000 }, (_, i) => ({
          route_id: 'r1', order_id: `o${i}`, status: 'pending', completed_at: null, estimated_at: null, updated_at: '2026-09-04T10:00:00Z',
        }));
        return chainable({ data: rows, error: null });
      }
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toMatch(/max_rows cap/);
  });

  it('chunks dispatches by expected rows (30 route ids/chunk), not by route count', async () => {
    const routeIds = Array.from({ length: 40 }, (_, i) => `r${i}`);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'routes') {
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) return chainable({ data: routeIds.map((id) => routeRow({ id })), error: null });
        return chainable({ data: [], error: null });
      }
      if (table === 'dispatches') return chainable({ data: [], error: null });
      return chainable({ data: [], error: null });
    });

    const { result } = renderHook(() => useEnRutaSnapshot('op-1', '2026-09-04'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 40 route ids at 30/chunk is 2 chunks, not 1.
    const dispatchCalls = mockFrom.mock.calls.filter((c) => c[0] === 'dispatches').length;
    expect(dispatchCalls).toBe(2);
  });
});
