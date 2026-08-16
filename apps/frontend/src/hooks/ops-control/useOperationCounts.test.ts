import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOperationCounts } from './useOperationCounts';

const mockUseSnapshot = vi.fn();
vi.mock('./useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: (...args: unknown[]) => mockUseSnapshot(...args),
}));

function snapshotWith(orders: Record<string, unknown>[]) {
  return {
    snapshot: { orders, routes: [], pickups: [], returns: [], retailerSlaConfig: [], fetchedAt: new Date() },
    isLoading: false,
    error: null,
    lastSyncAt: null,
  };
}

const NOW = new Date('2026-08-16T12:00:00');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useOperationCounts', () => {
  it('counts orders past pickup and before delivery as in operation', () => {
    mockUseSnapshot.mockReturnValue(snapshotWith([
      { id: 'o1', status: 'verificado', effective_delivery_date: '2026-08-20' },
      { id: 'o2', status: 'en_bodega', effective_delivery_date: '2026-08-20' },
      { id: 'o3', status: 'en_ruta', effective_delivery_date: '2026-08-20' },
      // Not yet picked up — ingresado is pre-operation
      { id: 'o4', status: 'ingresado', effective_delivery_date: '2026-08-20' },
    ]));
    const { result } = renderHook(() => useOperationCounts('op-1', NOW));
    expect(result.current.inOperation).toBe(3);
    expect(result.current.late).toBe(0);
  });

  it('counts an order as late when its effective delivery date is before today', () => {
    mockUseSnapshot.mockReturnValue(snapshotWith([
      { id: 'o1', status: 'en_bodega', effective_delivery_date: '2026-03-18' },
      { id: 'o2', status: 'en_ruta', effective_delivery_date: '2026-08-15' },
      { id: 'o3', status: 'asignado', effective_delivery_date: '2026-08-16' }, // today — not late
      { id: 'o4', status: 'en_carga', effective_delivery_date: '2026-08-17' }, // tomorrow
    ]));
    const { result } = renderHook(() => useOperationCounts('op-1', NOW));
    expect(result.current.inOperation).toBe(4);
    expect(result.current.late).toBe(2);
  });

  it('does not count a not-yet-picked-up order as late even when overdue', () => {
    mockUseSnapshot.mockReturnValue(snapshotWith([
      { id: 'o1', status: 'ingresado', effective_delivery_date: '2026-03-18' },
    ]));
    const { result } = renderHook(() => useOperationCounts('op-1', NOW));
    expect(result.current.inOperation).toBe(0);
    expect(result.current.late).toBe(0);
  });

  it('falls back to delivery_date when effective_delivery_date is missing', () => {
    mockUseSnapshot.mockReturnValue(snapshotWith([
      { id: 'o1', status: 'en_bodega', delivery_date: '2026-08-10' },
    ]));
    const { result } = renderHook(() => useOperationCounts('op-1', NOW));
    expect(result.current.late).toBe(1);
  });

  it('reports loading while the snapshot has not arrived', () => {
    mockUseSnapshot.mockReturnValue({ snapshot: null, isLoading: true, error: null, lastSyncAt: null });
    const { result } = renderHook(() => useOperationCounts('op-1', NOW));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.inOperation).toBe(0);
  });
});
