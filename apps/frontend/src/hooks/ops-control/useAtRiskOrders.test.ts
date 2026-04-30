import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mock useOpsControlSnapshot ───────────────────────────────────────────────
vi.mock('./useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: vi.fn(),
}));

// ── Mock classifyRisk ─────────────────────────────────────────────────────────
vi.mock('@/app/app/operations-control/lib/sla', () => ({
  classifyRisk: vi.fn(),
}));

import { useOpsControlSnapshot } from './useOpsControlSnapshot';
import { classifyRisk } from '@/app/app/operations-control/lib/sla';
import { useAtRiskOrders } from './useAtRiskOrders';

const mockUseSnapshot = useOpsControlSnapshot as ReturnType<typeof vi.fn>;
const mockClassifyRisk = classifyRisk as ReturnType<typeof vi.fn>;

const NOW = new Date('2026-04-06T12:00:00Z');

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    stage: 'delivery',
    retailer: 'Retailer A',
    customer_name: 'Customer A',
    address: '123 Main St',
    delivered_at: null,
    delivery_date: '2026-04-06',
    delivery_window_start: '10:00',
    delivery_window_end: '14:00',
    rescheduled_delivery_date: null,
    rescheduled_window_start: null,
    rescheduled_window_end: null,
    ...overrides,
  };
}

function makeSnapshot(orders: Record<string, unknown>[]) {
  return {
    orders,
    routes: [],
    pickups: [],
    returns: [],
    retailerSlaConfig: [],
    fetchedAt: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAtRiskOrders', () => {
  it('excludes delivered orders', () => {
    const order = makeOrder({ id: 'o1', delivered_at: '2026-04-06T11:00:00Z' });
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot([order]), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'none', minutesRemaining: 0, label: '—' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    expect(result.current.orders).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });

  it('excludes ok orders (> 6h remaining)', () => {
    const order = makeOrder({ id: 'o1' });
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot([order]), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'ok', minutesRemaining: 500, label: '8h 20m restantes' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    expect(result.current.orders).toHaveLength(0);
  });

  it('includes late orders (negative minutesRemaining)', () => {
    const order = makeOrder({ id: 'o1' });
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot([order]), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'late', minutesRemaining: -30, label: 'ATRASADO 0h 30m' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].status).toBe('late');
    expect(result.current.orders[0].minutesRemaining).toBe(-30);
    expect(result.current.orders[0].id).toBe('o1');
  });

  it('includes at_risk orders (≤ 6h remaining)', () => {
    const order = makeOrder({ id: 'o1' });
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot([order]), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'at_risk', minutesRemaining: 120, label: '2h 0m restantes' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].status).toBe('at_risk');
    expect(result.current.orders[0].minutesRemaining).toBe(120);
  });

  it('sorts: late before at_risk; within group, smallest minutesRemaining first', () => {
    const orders = [
      makeOrder({ id: 'at_risk_50', }),
      makeOrder({ id: 'late_minus10' }),
      makeOrder({ id: 'at_risk_20' }),
      makeOrder({ id: 'late_minus60' }),
    ];
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot(orders), isLoading: false, error: null });

    mockClassifyRisk.mockImplementation((order: Record<string, unknown>) => {
      const map: Record<string, { status: string; minutesRemaining: number; label: string }> = {
        at_risk_50:   { status: 'at_risk', minutesRemaining: 50,  label: '0h 50m restantes' },
        late_minus10: { status: 'late',    minutesRemaining: -10, label: 'ATRASADO 0h 10m' },
        at_risk_20:   { status: 'at_risk', minutesRemaining: 20,  label: '0h 20m restantes' },
        late_minus60: { status: 'late',    minutesRemaining: -60, label: 'ATRASADO 1h 0m' },
      };
      return map[order['id'] as string];
    });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    const ids = result.current.orders.map((o) => o.id);
    // late first (smallest = most negative = most urgent first)
    // late_minus60 (-60) < late_minus10 (-10): -60 is more negative → more urgent
    expect(ids[0]).toBe('late_minus60');
    expect(ids[1]).toBe('late_minus10');
    // then at_risk ascending
    expect(ids[2]).toBe('at_risk_20');
    expect(ids[3]).toBe('at_risk_50');
  });

  it('paginates 25/page', () => {
    const orders = Array.from({ length: 30 }, (_, i) => makeOrder({ id: `o${i}` }));
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot(orders), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'at_risk', minutesRemaining: 100, label: '1h 40m restantes' });

    const { result: page1 } = renderHook(() => useAtRiskOrders('op-1', NOW, 1));
    const { result: page2 } = renderHook(() => useAtRiskOrders('op-1', NOW, 2));

    expect(page1.current.orders).toHaveLength(25);
    expect(page2.current.orders).toHaveLength(5);
    expect(page1.current.pageCount).toBe(2);
  });

  it('excludes orders with status=ingresado (pickup not confirmed)', () => {
    // Pre-pickup orders are imported but not yet in the operator's physical
    // custody. They cannot be "late" on delivery because the pickup hasn't
    // happened yet. Only count orders we actually have in our power.
    const order = makeOrder({ id: 'o1', status: 'ingresado' });
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot([order]), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'late', minutesRemaining: -120, label: 'ATRASADO 2h 0m' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    expect(result.current.orders).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });

  it('includes late orders past pickup (e.g. en_bodega, verificado)', () => {
    const orders = [
      makeOrder({ id: 'verif',   status: 'verificado' }),
      makeOrder({ id: 'bodega',  status: 'en_bodega' }),
      makeOrder({ id: 'ruta',    status: 'en_ruta' }),
    ];
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot(orders), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'late', minutesRemaining: -30, label: 'ATRASADO 0h 30m' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW));

    expect(result.current.total).toBe(3);
  });

  it('total reflects all matching orders, not just current page', () => {
    const orders = Array.from({ length: 40 }, (_, i) => makeOrder({ id: `o${i}` }));
    mockUseSnapshot.mockReturnValue({ snapshot: makeSnapshot(orders), isLoading: false, error: null });
    mockClassifyRisk.mockReturnValue({ status: 'late', minutesRemaining: -5, label: 'ATRASADO 0h 5m' });

    const { result } = renderHook(() => useAtRiskOrders('op-1', NOW, 1));

    expect(result.current.total).toBe(40);
    expect(result.current.orders).toHaveLength(25);
    expect(result.current.pageCount).toBe(2);
  });
});
