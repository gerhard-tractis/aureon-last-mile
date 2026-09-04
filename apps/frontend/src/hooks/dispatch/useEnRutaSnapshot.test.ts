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

/** Builds a chainable query mock that resolves to `result` after any
 * sequence of .select/.eq/.in/.is calls — every method returns the same
 * thenable object, which resolves once awaited. */
function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
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
        // First call (on-road) then second call (completed today) — return
        // via a counter so both queries can be told apart.
        const calls = mockFrom.mock.calls.filter((c) => c[0] === 'routes').length;
        if (calls === 1) {
          return chainable({
            data: [{
              id: 'r1', external_route_id: 'RUT-1', driver_name: 'Mario',
              vehicle_id: 'v1', status: 'in_transit', route_date: '2026-09-04',
              planned_stops: 2, completed_stops: 1,
            }],
            error: null,
          });
        }
        return chainable({ data: [], error: null });
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
    expect(snapshot.completadas).toHaveLength(0);
    expect(snapshot.metrics.entregadas).toBe(1);
    expect(snapshot.metrics.fallidas).toBe(1);
    expect(snapshot.fallidasSinReingreso).toBe(1); // o2's order is still en_retorno
  });
});
