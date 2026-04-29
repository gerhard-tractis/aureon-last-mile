// apps/frontend/src/hooks/distribution/usePendingSectorization.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePendingSectorization } from './usePendingSectorization';

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
      data: [
        { id: 'z1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes'], is_active: true, operator_id: 'op-1' },
        { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true, operator_id: 'op-1' },
      ],
      isLoading: false,
    } as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('exposes order_number, comuna name and sku_items per package', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [
        { id: 'z1', name: 'Andén 1', code: 'A1', is_consolidation: false, comunas: [{ id: 'comuna-lc', nombre: 'Las Condes' }], is_active: true, operator_id: 'op-1' },
        { id: 'consol', name: 'Consolidación', code: 'CONS', is_consolidation: true, comunas: [], is_active: true, operator_id: 'op-1' },
      ],
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
    const pkg = result.current.data![0].packages[0];
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
      data: [
        { id: 'consol', name: 'Consolidación', code: 'CONS', is_consolidation: true, comunas: [], is_active: true, operator_id: 'op-1' },
      ],
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
    const pkg = result.current.data![0].packages[0];
    expect(pkg.comunaName).toBeNull();
    expect(pkg.skuItems).toEqual([]);
  });
});
