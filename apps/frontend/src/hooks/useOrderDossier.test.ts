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
    routes: { external_route_id: 'R-2481', driver_name: 'M. Rojas' },
  },
];

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
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: MOCK_DISPATCH_ROWS, error: null }),
      };
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
    });
  });

  it('filters the dispatches query by operator_id and excludes soft-deleted rows', async () => {
    const dispatchesEq = vi.fn().mockReturnThis();
    const dispatchesIs = vi.fn().mockResolvedValue({ data: [], error: null });
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: dispatchesEq,
          is: dispatchesIs,
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-42'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(dispatchesEq).toHaveBeenCalledWith('operator_id', 'op-42');
    expect(dispatchesIs).toHaveBeenCalledWith('deleted_at', null);
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDossier('order-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.packages).toHaveLength(1);
    expect(result.current.data!.packages[0].id).toBe('pkg-live');
  });
});
