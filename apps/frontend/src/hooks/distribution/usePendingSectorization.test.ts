// apps/frontend/src/hooks/distribution/usePendingSectorization.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePendingSectorization } from './usePendingSectorization';
import type { DockZoneRecord } from './useDockZones';

const mockIs = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: vi.fn(() => ({ data: [], isLoading: false })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs });
  mockIs.mockReturnValue({ order: mockOrder });
  mockOrder.mockResolvedValue({ data: [], error: null });
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, {
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }, children);

const ZONE_ANDEN: DockZoneRecord = {
  id: 'z1',
  name: 'Andén 1',
  code: 'A1',
  is_consolidation: false,
  comunas: [{ id: 'comuna-lc', nombre: 'Las Condes' }],
  is_active: true,
  operator_id: 'op-1',
};

const ZONE_CONSOL: DockZoneRecord = {
  id: 'consol',
  name: 'Consolidación',
  code: 'CONS',
  is_consolidation: true,
  comunas: [],
  is_active: true,
  operator_id: 'op-1',
};

describe('usePendingSectorization', () => {
  it('returns empty array when no en_bodega packages', async () => {
    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    // zones is empty, so query is disabled → fetchStatus idle
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => usePendingSectorization(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns empty array when zones exist but no packages', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns orders: OrderGroup[] within each ZoneGroup — no packages field at top level', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-1', label: 'PKG-0041', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const group = result.current.data![0];
    expect('packages' in group).toBe(false);
    expect(Array.isArray(group.orders)).toBe(true);
  });

  it('groups packages from the same order_id into one OrderGroup', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-1', label: 'PKG-0042', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-2', label: 'PKG-0041', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-3', label: 'PKG-0043', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const group = result.current.data![0];
    expect(group.orders).toHaveLength(1);
    expect(group.orders[0].orderId).toBe('ord-1');
    expect(group.orders[0].packages).toHaveLength(3);
  });

  it('packages within an OrderGroup are sorted by label ASC', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-c', label: 'PKG-0043', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-a', label: 'PKG-0041', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-b', label: 'PKG-0042', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const pkgs = result.current.data![0].orders[0].packages;
    expect(pkgs.map(p => p.label)).toEqual(['PKG-0041', 'PKG-0042', 'PKG-0043']);
  });

  it('ZoneGroup.orders sorted by deliveryDate ASC (most urgent first)', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-late', label: 'PKG-0055', order_id: 'ord-late', sku_items: [],
          orders: { order_number: '#1003', comuna_id: 'comuna-lc', delivery_date: '2026-05-12', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-urgent', label: 'PKG-0041', order_id: 'ord-urgent', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-09', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-mid', label: 'PKG-0048', order_id: 'ord-mid', sku_items: [],
          orders: { order_number: '#1002', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const orderDates = result.current.data![0].orders.map(o => o.deliveryDate);
    expect(orderDates).toEqual(['2026-05-09', '2026-05-10', '2026-05-12']);
  });

  it('packages from different orders in the same zone get separate OrderGroups', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-1', label: 'PKG-0041', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
        {
          id: 'pkg-2', label: 'PKG-0055', order_id: 'ord-2', sku_items: [],
          orders: { order_number: '#1002', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const group = result.current.data![0];
    expect(group.orders).toHaveLength(2);
    expect(group.orders[0].orderId).toBe('ord-1');
    expect(group.orders[1].orderId).toBe('ord-2');
  });

  it('OrderGroup exposes orderId, orderNumber, deliveryDate, comunaName', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-1', label: 'PKG-0041', order_id: 'ord-1', sku_items: [],
          orders: { order_number: '#1001', comuna_id: 'comuna-lc', delivery_date: '2026-05-10', chile_comunas: { nombre: 'Las Condes' } },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const order = result.current.data![0].orders[0];
    expect(order.orderId).toBe('ord-1');
    expect(order.orderNumber).toBe('#1001');
    expect(order.deliveryDate).toBe('2026-05-10');
    expect(order.comunaName).toBe('Las Condes');
  });

  it('exposes sku_items per package within OrderGroup', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_ANDEN, ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-1',
          label: 'PKG-OP82-1834',
          order_id: 'ord-1',
          sku_items: [
            { sku: 'SKU-44831', description: 'Audífonos Bluetooth Pro', quantity: 2 },
            { sku: 'SKU-44219', description: 'Cargador 65W USB-C', quantity: 1 },
          ],
          orders: {
            order_number: 'ORD-2026-04-2841',
            comuna_id: 'comuna-lc',
            delivery_date: '2026-04-29',
            chile_comunas: { nombre: 'Las Condes' },
          },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    const pkg = result.current.data![0].orders[0].packages[0];
    expect(pkg.label).toBe('PKG-OP82-1834');
    expect(pkg.orderNumber).toBe('ORD-2026-04-2841');
    expect(pkg.comunaName).toBe('Las Condes');
    expect(pkg.delivery_date).toBe('2026-04-29');
    expect(pkg.skuItems).toEqual([
      { sku: 'SKU-44831', description: 'Audífonos Bluetooth Pro', quantity: 2 },
      { sku: 'SKU-44219', description: 'Cargador 65W USB-C', quantity: 1 },
    ]);
  });

  it('handles missing comuna join and empty sku_items gracefully', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [ZONE_CONSOL],
      isLoading: false,
    } as unknown as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'pkg-2',
          label: 'PKG-2',
          order_id: 'ord-2',
          sku_items: null,
          orders: {
            order_number: 'ORD-2',
            comuna_id: null,
            delivery_date: '2026-04-29',
            chile_comunas: null,
          },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const pkg = result.current.data![0].orders[0].packages[0];
    expect(pkg.comunaName).toBeNull();
    expect(pkg.skuItems).toEqual([]);
  });
});
