import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOrderDossier } from './useOrderDossier';

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

const MOCK_ORDER_ROW = {
  id: 'order-1',
  order_number: 'ORD-001',
  retailer_name: 'Retailer A',
  customer_name: 'John Doe',
  customer_phone: '+56912345678',
  delivery_address: '123 Main St',
  comuna: 'Las Condes',
  delivery_date: '2026-03-16',
  delivery_window_start: '2026-03-16T10:00:00',
  delivery_window_end: '2026-03-16T12:00:00',
  status: 'en_ruta',
  leading_status: 'en_ruta',
  external_load_id: null,
  imported_via: 'API',
  rescheduled_delivery_date: null,
  rescheduled_window_start: null,
  rescheduled_window_end: null,
  packages: [
    {
      id: 'pkg-1',
      label: 'PKG-001',
      package_number: 'PKG001',
      status: 'retenido',
      status_updated_at: '2026-03-16T09:00:00',
      declared_weight_kg: 2.4,
      verified_weight_kg: null,
      dock_zone: { name: 'Andén A3' },
    },
  ],
};

const MOCK_AUDIT_ENTRIES = [
  {
    id: 'audit-1',
    action: 'CSV_IMPORT',
    timestamp: '2026-03-16T08:00:00',
    changes_json: null,
  },
];

const MOCK_DISPATCH_ROWS = [
  {
    id: 'dp-1',
    substatus: 'Recibido por cliente',
    substatus_code: '00',
    status: 'delivered',
    completed_at: '2026-03-16T11:00:00',
    arrived_at: '2026-03-16T10:55:00',
    estimated_at: '2026-03-16T10:30:00',
    failure_reason: null,
    latitude: -33.45,
    longitude: -70.66,
    raw_data: { attempt: 1 },
    is_pickup: false,
    external_dispatch_id: 'DT-9910442',
    routes: { id: 'route-uuid-1', external_route_id: 'R-2481', driver_name: 'M. Rojas' },
  },
];

/**
 * spec-65 Task 8, controller ruling round 3 — the dispatches query now
 * chains two `.order()` calls (completed_at desc, id desc tiebreak) before
 * Supabase's real (thenable) query builder resolves. `mockResolvedValue` on
 * a single method can't represent "resolves only after N chained calls", so
 * this stands in for the real builder: every chainable method returns the
 * same thenable object, and awaiting it resolves with the given result —
 * regardless of how many `.order()`/`.eq()` calls precede the await.
 */
function dispatchesChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: { data: unknown[]; error: unknown }) => void) =>
      resolve({ data, error }),
  };
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  return chain;
}

function buildFromMock(overrides: Partial<Record<string, unknown>> = {}) {
  return (table: string) => {
    if (table === 'orders') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
      };
    }
    if (table === 'audit_logs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: MOCK_AUDIT_ENTRIES, error: null }),
      };
    }
    if (table === 'dispatches') {
      return dispatchesChain(MOCK_DISPATCH_ROWS);
    }
    if (table === 'manifests') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    return overrides[table] ?? {};
  };
}

describe('useOrderDossier', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when orderId is null', () => {
    const { result } = renderHook(() => useOrderDossier(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useOrderDossier('order-1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns order, packages, auditLogs and dispatches merged', async () => {
    mockFrom.mockImplementation(buildFromMock());

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.order_number).toBe('ORD-001');
    expect(data.packages).toHaveLength(1);
    expect(data.packages[0].dock_zone_name).toBe('Andén A3');
    expect(data.packages[0].declared_weight_kg).toBe(2.4);
    expect(data.auditLogs).toHaveLength(1);
    expect(data.dispatches).toHaveLength(1);
    expect(data.dispatches[0]).toMatchObject({
      id: 'dp-1',
      substatus: 'Recibido por cliente',
      substatus_code: '00',
      external_route_id: 'R-2481',
      driver_name: 'M. Rojas',
      route_id: 'route-uuid-1',
      external_dispatch_id: 'DT-9910442',
    });
  });

  // spec-65 Task 9, controller-authorized extension — 3b's header SLA-delta
  // badge, ORIGEN DE LOS DATOS "Canal" line, and courier guide-number chip
  // all need columns the dossier didn't select before. Asserted on their
  // own line each so a regression on any one fails named, not buried.
  it('selects orders.imported_via', async () => {
    mockFrom.mockImplementation(buildFromMock());
    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.imported_via).toBe('API');
  });

  it('selects the reschedule columns from orders', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...MOCK_ORDER_ROW,
              rescheduled_delivery_date: '2026-03-20',
              rescheduled_window_start: '13:00:00',
              rescheduled_window_end: '14:00:00',
            },
            error: null,
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') return dispatchesChain([]);
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.rescheduled_delivery_date).toBe('2026-03-20');
    expect(result.current.data!.rescheduled_window_start).toBe('13:00:00');
    expect(result.current.data!.rescheduled_window_end).toBe('14:00:00');
  });

  it('selects external_dispatch_id on the dispatches query', async () => {
    mockFrom.mockImplementation(buildFromMock());
    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.dispatches[0].external_dispatch_id).toBe('DT-9910442');
  });

  it('derives delivered_at from the most recent NON-PICKUP delivered dispatch', async () => {
    mockFrom.mockImplementation(buildFromMock());
    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.delivered_at).toBe('2026-03-16T11:00:00');
  });

  // Controller ruling — a completed PICKUP leg also carries
  // status = 'delivered'; counting it as the order's delivery was a real
  // bug caught in Task 2's review of the SQL twin of this rule.
  it('excludes a delivered PICKUP dispatch from the delivered_at derivation', async () => {
    const pickupDelivered = {
      ...MOCK_DISPATCH_ROWS[0],
      id: 'dp-pickup',
      is_pickup: true,
      completed_at: '2026-03-16T23:00:00',
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'dispatches') return dispatchesChain([pickupDelivered]);
      return buildFromMock()(table);
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.delivered_at).toBeNull();
  });

  it('leaves delivered_at null when no dispatch has status = delivered', async () => {
    const inTransit = { ...MOCK_DISPATCH_ROWS[0], status: 'in_transit' };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'dispatches') return dispatchesChain([inTransit]);
      return buildFromMock()(table);
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.delivered_at).toBeNull();
  });

  // spec-65 Task 8, controller ruling — "Abrir en ruta" needs routes.id (the
  // uuid /app/dispatch/[routeId] indexes by), not external_route_id (a
  // provider-supplied string). Asserted separately from the object above so
  // a regression here fails on its own, named line, not buried in a
  // toMatchObject with six other fields.
  it('resolves route_id from the joined routes row, not from external_route_id', async () => {
    mockFrom.mockImplementation(buildFromMock());

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.dispatches[0].route_id).toBe('route-uuid-1');
  });

  it('leaves route_id null when the dispatch has no joined route', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return dispatchesChain([{ ...MOCK_DISPATCH_ROWS[0], routes: null }]);
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.dispatches[0].route_id).toBeNull();
  });

  it('filters the dispatches query by operator_id and excludes soft-deleted rows', async () => {
    const chain = dispatchesChain([]);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return chain;
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-42'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-42');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  // Controller ruling, round 3 — dispatches.find(d => !d.is_pickup) picks
  // whatever Postgres returns first. With no ORDER BY, a retried delivery
  // (more than one non-pickup dispatch for the same order) resolves
  // nondeterministically; ProofOfDelivery/the ruta chip/"Abrir en ruta" would
  // then risk showing a superseded attempt's data. The query itself must
  // order deterministically so every dossier consumer inherits it.
  it('orders the dispatches query by completed_at desc, then id desc as a tiebreak', async () => {
    const chain = dispatchesChain([]);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return chain;
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(chain.order).toHaveBeenNthCalledWith(1, 'completed_at', { ascending: false });
    expect(chain.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
  });

  it('returns a retried orders dispatches with the newest attempt first, per the query order', async () => {
    const older = { ...MOCK_DISPATCH_ROWS[0], id: 'dp-older', completed_at: '2026-03-16T09:00:00', failure_reason: 'Nadie en casa' };
    const newer = { ...MOCK_DISPATCH_ROWS[0], id: 'dp-newer', completed_at: '2026-03-16T11:00:00', failure_reason: null };
    // The query orders completed_at DESC — the mock returns rows in that
    // already-ordered shape, the same contract the real Postgres query makes.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'dispatches') return dispatchesChain([newer, older]);
      return buildFromMock()(table);
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.dispatches).toHaveLength(2);
    expect(result.current.data!.dispatches[0].id).toBe('dp-newer');
    expect(result.current.data!.dispatches[1].id).toBe('dp-older');
  });

  it('treats a package with no dock zone or weight as having those fields absent, not zero or dash', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...MOCK_ORDER_ROW,
              packages: [
                {
                  id: 'pkg-2',
                  label: 'PKG-002',
                  package_number: null,
                  status: 'en_bodega',
                  status_updated_at: null,
                  declared_weight_kg: null,
                  verified_weight_kg: null,
                  dock_zone: null,
                },
              ],
            },
            error: null,
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return dispatchesChain([]);
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.packages[0].dock_zone_name).toBeNull();
    expect(result.current.data!.packages[0].declared_weight_kg).toBeNull();
    expect(result.current.data!.packages[0].verified_weight_kg).toBeNull();
  });

  // Review round 1 — the orders query had no deleted_at filter at all, which
  // meant a soft-deleted order rendered a full dossier. manifests, dispatches
  // and packages were already covered; only orders and audit_logs were not.
  it('filters the orders query by operator_id and excludes soft-deleted orders', async () => {
    const ordersEq = vi.fn().mockReturnThis();
    const ordersIs = vi.fn().mockReturnThis();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: ordersEq,
          is: ordersIs,
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return dispatchesChain([]);
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-42'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(ordersEq).toHaveBeenCalledWith('operator_id', 'op-42');
    expect(ordersIs).toHaveBeenCalledWith('deleted_at', null);
  });

  it('filters the audit_logs query by operator_id', async () => {
    const auditEq = vi.fn().mockReturnThis();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: auditEq,
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return dispatchesChain([]);
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-42'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(auditEq).toHaveBeenCalledWith('operator_id', 'op-42');
  });

  it('excludes a soft-deleted package from the returned dossier', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...MOCK_ORDER_ROW,
              packages: [
                { ...MOCK_ORDER_ROW.packages[0], id: 'pkg-live', deleted_at: null },
                { ...MOCK_ORDER_ROW.packages[0], id: 'pkg-deleted', deleted_at: '2026-03-16T10:00:00' },
              ],
            },
            error: null,
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'dispatches') {
        return dispatchesChain([]);
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.packages).toHaveLength(1);
    expect(result.current.data!.packages[0].id).toBe('pkg-live');
  });
});
