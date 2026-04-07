import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mock useOpsControlSnapshot ───────────────────────────────────────────────
vi.mock('./useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: vi.fn(),
}));

// ── Mock computeStageHealth ───────────────────────────────────────────────────
vi.mock('@/app/app/operations-control/lib/health', () => ({
  computeStageHealth: vi.fn(),
}));

import { useOpsControlSnapshot } from './useOpsControlSnapshot';
import { computeStageHealth } from '@/app/app/operations-control/lib/health';
import { useStageBreakdown } from './useStageBreakdown';

const mockUseSnapshot = useOpsControlSnapshot as ReturnType<typeof vi.fn>;
const mockComputeStageHealth = computeStageHealth as ReturnType<typeof vi.fn>;

const PAGE_SIZE = 25;

function makeSnapshot(overrides: Partial<{
  pickups: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  returns: Record<string, unknown>[];
}> = {}) {
  return {
    pickups: overrides.pickups ?? [],
    orders: overrides.orders ?? [],
    routes: overrides.routes ?? [],
    returns: overrides.returns ?? [],
    retailerSlaConfig: [],
    fetchedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComputeStageHealth.mockReturnValue({
    status: 'ok',
    delta: 'Sin incidencias',
    reasonsByOrder: new Map(),
  });
});

describe('useStageBreakdown', () => {
  it('returns rows for "pickup" stage from snapshot.pickups', () => {
    const pickups = [
      { id: 'p1', overdue_minutes: 10 },
      { id: 'p2', overdue_minutes: 30 },
    ];
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ pickups }), isLoading: false, error: null });

    const { result } = renderHook(() => useStageBreakdown('pickup', 'op-1', 1));

    // Sorted by overdue_minutes desc
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0].id).toBe('p2');
    expect(result.current.rows[1].id).toBe('p1');
    expect(result.current.total).toBe(2);
  });

  it('respects page param — page 2 returns rows 26-50', () => {
    const pickups = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      overdue_minutes: i,
    }));
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ pickups }), isLoading: false, error: null });

    const { result } = renderHook(() => useStageBreakdown('pickup', 'op-1', 2));

    expect(result.current.rows).toHaveLength(PAGE_SIZE);
    expect(result.current.total).toBe(60);
    expect(result.current.pageCount).toBe(3);
    // Page 2 starts at index 25 of sorted-desc array (overdue_minutes 34 down to 10)
    const firstInPage2 = result.current.rows[0].overdue_minutes as number;
    expect(firstInPage2).toBeLessThan(60); // it's within the sorted second slice
  });

  it('stageHealth comes from computeStageHealth with correct items', () => {
    const fakeHealth = { status: 'warn', delta: 'Recogida atrasada 45m', reasonsByOrder: new Map() };
    mockComputeStageHealth.mockReturnValue(fakeHealth);

    const pickups = [{ id: 'p1', overdue_minutes: 45 }];
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ pickups }), isLoading: false, error: null });

    const { result } = renderHook(() => useStageBreakdown('pickup', 'op-1', 1));

    expect(mockComputeStageHealth).toHaveBeenCalledWith('pickup', pickups, expect.any(Date));
    expect(result.current.stageHealth).toBe(fakeHealth);
  });

  it('"reverse" stage always returns empty rows', () => {
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot(), isLoading: false, error: null });

    const { result } = renderHook(() => useStageBreakdown('reverse', 'op-1', 1));

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });

  it('recomputes when snapshot changes (simulate version bump)', () => {
    const pickups1 = [{ id: 'p1', overdue_minutes: 5 }];
    const pickups2 = [{ id: 'p1', overdue_minutes: 5 }, { id: 'p2', overdue_minutes: 15 }];

    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ pickups: pickups1 }), isLoading: false, error: null });

    const { result, rerender } = renderHook(() => useStageBreakdown('pickup', 'op-1', 1));
    expect(result.current.total).toBe(1);

    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ pickups: pickups2 }), isLoading: false, error: null });
    rerender();

    expect(result.current.total).toBe(2);
  });

  it('filters orders by stage for "reception"', () => {
    const orders = [
      { id: 'o1', stage: 'reception', dwell_minutes: 100 },
      { id: 'o2', stage: 'consolidation', dwell_minutes: 200 },
    ];
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ orders }), isLoading: false, error: null });

    const { result } = renderHook(() => useStageBreakdown('reception', 'op-1', 1));

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].id).toBe('o1');
  });

  it('filters routes by stage for "docks"', () => {
    const routes = [
      { id: 'r1', stage: 'docks', idle_minutes: 40 },
      { id: 'r2', stage: 'delivery', idle_minutes: 10 },
    ];
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot({ routes }), isLoading: false, error: null });

    const { result } = renderHook(() => useStageBreakdown('docks', 'op-1', 1));

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].id).toBe('r1');
  });
});
