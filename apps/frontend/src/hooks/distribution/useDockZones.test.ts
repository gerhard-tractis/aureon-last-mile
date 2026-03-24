// apps/frontend/src/hooks/distribution/useDockZones.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDockZones, useCreateDockZone, useUpdateDockZone, useDeleteDockZone, useEnsureConsolidationZone } from './useDockZones';

let mockQueryResult: { data: unknown; error: unknown } = { data: [], error: null };

function createChain(): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockImplementation(() => {
    // Return a new object that supports another .order() but also resolves
    const inner: Record<string, ReturnType<typeof vi.fn>> = {};
    inner.order = vi.fn().mockImplementation(() => Promise.resolve(mockQueryResult));
    return inner;
  });
  return chain;
}

let mockFromFn: ReturnType<typeof vi.fn>;
let mockInsertFn: ReturnType<typeof vi.fn>;
let mockUpdateFn: ReturnType<typeof vi.fn>;
let mockDeleteFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryResult = { data: [], error: null };
  mockInsertFn = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'new-zone-id' }, error: null }),
    }),
    // for inserts without .select().single() (junction table inserts, consolidation zone)
    then: undefined,
  });
  mockUpdateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  });
  mockDeleteFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  });
  mockFromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'dock_zones') {
      return {
        ...createChain(),
        insert: mockInsertFn,
        update: mockUpdateFn,
        delete: mockDeleteFn,
      };
    }
    // dock_zone_comunas junction table
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
  });
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useDockZones', () => {
  it('returns empty array when no zones configured', async () => {
    const { result } = renderHook(() => useDockZones('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useDockZones(null), { wrapper });
    expect(mockFromFn).not.toHaveBeenCalled();
  });

  it('returns zones with flattened comunas from junction table', async () => {
    const zones = [
      {
        id: 'zone-1',
        name: 'Andén 1',
        code: 'DOCK-001',
        is_consolidation: false,
        is_active: true,
        operator_id: 'op-1',
        dock_zone_comunas: [{ chile_comunas: { id: 'c1', nombre: 'Las Condes' } }],
      },
      {
        id: 'consol',
        name: 'Consolidación',
        code: 'CONSOL',
        is_consolidation: true,
        is_active: true,
        operator_id: 'op-1',
        dock_zone_comunas: [],
      },
    ];
    mockQueryResult = { data: zones, error: null };
    const { result } = renderHook(() => useDockZones('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].comunas).toEqual([{ id: 'c1', nombre: 'Las Condes' }]);
    expect(result.current.data![1].comunas).toEqual([]);
  });

  it('returns zones sorted with consolidation first', async () => {
    const zones = [
      {
        id: 'zone-1',
        name: 'Andén 1',
        code: 'DOCK-001',
        is_consolidation: false,
        is_active: true,
        operator_id: 'op-1',
        dock_zone_comunas: [],
      },
      {
        id: 'consol',
        name: 'Consolidación',
        code: 'CONSOL',
        is_consolidation: true,
        is_active: true,
        operator_id: 'op-1',
        dock_zone_comunas: [],
      },
    ];
    mockQueryResult = { data: zones, error: null };
    const { result } = renderHook(() => useDockZones('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });
});

describe('useCreateDockZone', () => {
  it('inserts dock zone and junction rows for comunaIds', async () => {
    const { result } = renderHook(() => useCreateDockZone('op-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Zona Norte', code: 'ZN', comunaIds: ['c1', 'c2'] });
    });
    // Verify dock_zones insert was called with correct fields (no comunas column)
    const dockZonesInsertCall = mockInsertFn.mock.calls[0]?.[0];
    expect(dockZonesInsertCall).toMatchObject({
      operator_id: 'op-1',
      name: 'Zona Norte',
      code: 'ZN',
      is_consolidation: false,
      is_active: true,
    });
    expect(dockZonesInsertCall).not.toHaveProperty('comunas');
  });
});

describe('useUpdateDockZone', () => {
  it('updates dock zone fields', async () => {
    const { result } = renderHook(() => useUpdateDockZone('op-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'zone-1', name: 'Updated', is_active: false });
    });
    expect(mockUpdateFn).toHaveBeenCalledWith({ name: 'Updated', is_active: false });
  });

  it('accepts comunaIds instead of comunas strings', async () => {
    const deleteFnOnJunction = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const insertFnOnJunction = vi.fn().mockResolvedValue({ error: null });
    mockFromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'dock_zones') {
        return {
          ...createChain(),
          insert: mockInsertFn,
          update: mockUpdateFn,
          delete: mockDeleteFn,
        };
      }
      return {
        insert: insertFnOnJunction,
        delete: deleteFnOnJunction,
      };
    });
    const { result } = renderHook(() => useUpdateDockZone('op-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'zone-1', comunaIds: ['c1', 'c2'] });
    });
    // delete old junction rows then insert new ones
    expect(deleteFnOnJunction).toHaveBeenCalled();
    expect(insertFnOnJunction).toHaveBeenCalledWith([
      { dock_zone_id: 'zone-1', comuna_id: 'c1' },
      { dock_zone_id: 'zone-1', comuna_id: 'c2' },
    ]);
  });
});

describe('useDeleteDockZone', () => {
  it('soft-deletes a zone by setting deleted_at', async () => {
    const { result } = renderHook(() => useDeleteDockZone('op-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('zone-1');
    });
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) })
    );
  });
});

describe('useEnsureConsolidationZone', () => {
  it('inserts without comunas column when no consolidation zone exists', async () => {
    // Simulate: no existing consolidation zone
    mockFromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'dock_zones') {
        return {
          ...createChain(),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
          insert: mockInsertFn,
          update: mockUpdateFn,
        };
      }
      return {};
    });
    const { result } = renderHook(() => useEnsureConsolidationZone('op-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    const insertCall = mockInsertFn.mock.calls[0]?.[0];
    expect(insertCall).toMatchObject({
      operator_id: 'op-1',
      name: 'Consolidación',
      code: 'CONSOL',
      is_consolidation: true,
      is_active: true,
    });
    expect(insertCall).not.toHaveProperty('comunas');
  });

  it('skips insert when consolidation zone already exists', async () => {
    mockFromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'dock_zones') {
        return {
          ...createChain(),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [{ id: 'existing' }], error: null }),
                }),
              }),
            }),
          }),
          insert: mockInsertFn,
          update: mockUpdateFn,
        };
      }
      return {};
    });
    const { result } = renderHook(() => useEnsureConsolidationZone('op-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(mockInsertFn).not.toHaveBeenCalled();
  });
});
