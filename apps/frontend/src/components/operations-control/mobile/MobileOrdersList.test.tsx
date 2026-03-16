/**
 * Tests for MobileOrdersList component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/components/operations-control/mobile/MobilePullToRefresh', () => ({
  MobilePullToRefresh: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pull-to-refresh-container">{children}</div>
  ),
}));

vi.mock('@/components/operations-control/mobile/MobileFilterModal', () => ({
  MobileFilterModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="mobile-filter-modal"><button onClick={onClose}>Cerrar modal</button></div> : null,
}));

vi.mock('@/components/operations-control/OrderDetailModal', () => ({
  OrderDetailModal: ({ orderId, onClose }: { orderId: string | null; onClose: () => void }) =>
    orderId ? <div data-testid="order-detail-modal"><button onClick={onClose}>Cerrar detalle</button></div> : null,
}));

vi.mock('@/components/operations-control/mobile/MobileOrderCard', () => ({
  MobileOrderCard: ({
    order,
    onView,
  }: {
    order: OperationsOrder;
    onView: () => void;
  }) => (
    <div data-testid={`order-card-${order.id}`} onClick={onView}>
      {order.order_number}
    </div>
  ),
}));

const mockSetStatusFilter = vi.fn();

const defaultStoreState = {
  search: '',
  datePreset: 'today' as const,
  dateRange: null,
  statusFilter: 'all' as const,
  stageFilter: null,
  setSearch: vi.fn(),
  setDatePreset: vi.fn(),
  setDateRange: vi.fn(),
  setStatusFilter: mockSetStatusFilter,
  setStageFilter: vi.fn(),
  clearAllFilters: vi.fn(),
};

vi.mock('@/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => defaultStoreState),
}));

import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { MobileOrdersList } from './MobileOrdersList';

// ── Helpers ────────────────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<OperationsOrder> = {}): OperationsOrder => ({
  id: 'ord-1',
  order_number: 'ORD-001',
  retailer_name: 'Falabella',
  customer_name: 'Juan Perez',
  comuna: 'Las Condes',
  delivery_date: '2026-03-16',
  delivery_window_start: null,
  delivery_window_end: null,
  status: 'en_bodega',
  leading_status: 'en_bodega',
  status_updated_at: null,
  operator_id: 'op-1',
  deleted_at: null,
  ...overrides,
});

function makeOrders(count: number, windowEndOffset?: number): OperationsOrder[] {
  return Array.from({ length: count }, (_, i) => {
    const windowEnd =
      windowEndOffset !== undefined
        ? new Date(Date.now() + windowEndOffset * 60000).toISOString()
        : null;
    return makeOrder({
      id: `ord-${i + 1}`,
      order_number: `ORD-${String(i + 1).padStart(3, '0')}`,
      delivery_window_end: windowEnd,
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MobileOrdersList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpsControlFilterStore).mockReturnValue(defaultStoreState);
  });

  // ── 1. Loading state ─────────────────────────────────────────────────────

  describe('Loading state', () => {
    it('renders 3 skeleton cards when isLoading=true', () => {
      render(<MobileOrdersList orders={[]} isLoading={true} operatorId="op-1" />);
      const skeletons = screen.getAllByTestId('order-skeleton');
      expect(skeletons).toHaveLength(3);
    });

    it('does not render order cards when isLoading=true', () => {
      const orders = [makeOrder()];
      render(<MobileOrdersList orders={orders} isLoading={true} operatorId="op-1" />);
      expect(screen.queryByTestId('order-card-ord-1')).toBeNull();
    });
  });

  // ── 2. Grouped order cards ───────────────────────────────────────────────

  describe('Grouped order cards', () => {
    it('renders group header for urgent orders', () => {
      const windowEnd = new Date(Date.now() + 30 * 60000).toISOString(); // 30 mins = urgent
      const order = makeOrder({ id: 'u1', delivery_window_end: windowEnd });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('group-header-urgent')).toBeTruthy();
    });

    it('renders group header for ok orders', () => {
      const order = makeOrder({ id: 'ok1', delivery_window_end: null });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('group-header-ok')).toBeTruthy();
    });

    it('renders group header for late orders', () => {
      const past = new Date(Date.now() - 60 * 60000).toISOString();
      const order = makeOrder({ id: 'l1', delivery_window_end: past });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('group-header-late')).toBeTruthy();
    });

    it('renders group header for alert orders', () => {
      const windowEnd = new Date(Date.now() + 100 * 60000).toISOString(); // 100 mins = alert
      const order = makeOrder({ id: 'a1', delivery_window_end: windowEnd });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('group-header-alert')).toBeTruthy();
    });

    it('shows order count in group header', () => {
      const windowEnd = new Date(Date.now() + 30 * 60000).toISOString();
      const orders = [
        makeOrder({ id: 'u1', order_number: 'ORD-001', delivery_window_end: windowEnd }),
        makeOrder({ id: 'u2', order_number: 'ORD-002', delivery_window_end: windowEnd }),
      ];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      const header = screen.getByTestId('group-header-urgent');
      expect(header.textContent).toContain('2');
    });

    it('does not render group header when no orders in that group', () => {
      const order = makeOrder({ id: 'ok1', delivery_window_end: null });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      expect(screen.queryByTestId('group-header-urgent')).toBeNull();
      expect(screen.queryByTestId('group-header-late')).toBeNull();
      expect(screen.queryByTestId('group-header-alert')).toBeNull();
    });

    it('renders orders in pull-to-refresh wrapper', () => {
      const order = makeOrder();
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('pull-to-refresh-container')).toBeTruthy();
    });
  });

  // ── 3. Search: filter by order_number ────────────────────────────────────

  describe('Search: filter by order_number', () => {
    it('expands search input when search toggle clicked', () => {
      render(<MobileOrdersList orders={[makeOrder()]} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('search-toggle'));
      expect(screen.getByTestId('search-input')).toBeTruthy();
    });

    it('filters orders by order_number (case-insensitive)', () => {
      const orders = [
        makeOrder({ id: 'a', order_number: 'ORD-ABC' }),
        makeOrder({ id: 'b', order_number: 'ORD-XYZ' }),
      ];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('search-toggle'));
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'abc' } });
      expect(screen.getByTestId('order-card-a')).toBeTruthy();
      expect(screen.queryByTestId('order-card-b')).toBeNull();
    });
  });

  // ── 4. Search: filter by retailer_name ───────────────────────────────────

  describe('Search: filter by retailer_name', () => {
    it('filters orders by retailer_name (case-insensitive)', () => {
      const orders = [
        makeOrder({ id: 'a', retailer_name: 'Falabella' }),
        makeOrder({ id: 'b', retailer_name: 'Ripley' }),
      ];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('search-toggle'));
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'ripley' } });
      expect(screen.getByTestId('order-card-b')).toBeTruthy();
      expect(screen.queryByTestId('order-card-a')).toBeNull();
    });
  });

  // ── 5. Search results label ──────────────────────────────────────────────

  describe('Search results label', () => {
    it('shows "X resultados para \'query\'" when search is active', () => {
      const orders = [
        makeOrder({ id: 'a', order_number: 'ORD-ABC', retailer_name: 'Ripley' }),
        makeOrder({ id: 'b', order_number: 'ORD-ABX', retailer_name: 'Ripley' }),
        makeOrder({ id: 'c', order_number: 'ORD-ZZZ', retailer_name: 'Ripley' }),
      ];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('search-toggle'));
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'AB' } });
      expect(screen.getByTestId('search-results-label')).toBeTruthy();
      expect(screen.getByTestId('search-results-label').textContent).toContain('2');
      expect(screen.getByTestId('search-results-label').textContent).toContain('AB');
    });

    it('does not show results label when search is empty', () => {
      render(<MobileOrdersList orders={[makeOrder()]} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('search-toggle'));
      expect(screen.queryByTestId('search-results-label')).toBeNull();
    });
  });

  // ── 6. Load more ─────────────────────────────────────────────────────────

  describe('Load more', () => {
    it('shows load-more button when orders > 20', () => {
      const orders = makeOrders(25);
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('load-more-btn')).toBeTruthy();
    });

    it('does not show load-more button when orders <= 20', () => {
      const orders = makeOrders(20);
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      expect(screen.queryByTestId('load-more-btn')).toBeNull();
    });

    it('clicking load-more increases visible count', () => {
      const orders = makeOrders(25);
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      // 20 cards visible initially
      fireEvent.click(screen.getByTestId('load-more-btn'));
      // All 25 should now be visible (no more load-more button)
      expect(screen.queryByTestId('load-more-btn')).toBeNull();
    });
  });

  // ── 7. Empty state ───────────────────────────────────────────────────────

  describe('Empty state', () => {
    it('shows empty message when orders is empty and not loading', () => {
      render(<MobileOrdersList orders={[]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('empty-state')).toBeTruthy();
    });

    it('shows empty message when search yields no matches', () => {
      const orders = [makeOrder({ id: 'a', order_number: 'ORD-001' })];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('search-toggle'));
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'ZZZZZZ' } });
      expect(screen.getByTestId('empty-state')).toBeTruthy();
    });

    it('does not show empty state when orders exist', () => {
      render(<MobileOrdersList orders={[makeOrder()]} isLoading={false} operatorId="op-1" />);
      expect(screen.queryByTestId('empty-state')).toBeNull();
    });
  });

  // ── 8. Order detail modal ────────────────────────────────────────────────

  describe('Order detail modal', () => {
    it('opens OrderDetailModal when order card is clicked', () => {
      const order = makeOrder({ id: 'ord-99' });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('order-card-ord-99'));
      expect(screen.getByTestId('order-detail-modal')).toBeTruthy();
    });

    it('closes OrderDetailModal when onClose is called', () => {
      const order = makeOrder({ id: 'ord-99' });
      render(<MobileOrdersList orders={[order]} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('order-card-ord-99'));
      expect(screen.getByTestId('order-detail-modal')).toBeTruthy();
      fireEvent.click(screen.getByText('Cerrar detalle'));
      expect(screen.queryByTestId('order-detail-modal')).toBeNull();
    });
  });

  // ── 9. Filter button opens MobileFilterModal ─────────────────────────────

  describe('Filter button', () => {
    it('renders filter button', () => {
      render(<MobileOrdersList orders={[]} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('filter-btn')).toBeTruthy();
    });

    it('opens MobileFilterModal when filter button clicked', () => {
      render(<MobileOrdersList orders={[]} isLoading={false} operatorId="op-1" />);
      expect(screen.queryByTestId('mobile-filter-modal')).toBeNull();
      fireEvent.click(screen.getByTestId('filter-btn'));
      expect(screen.getByTestId('mobile-filter-modal')).toBeTruthy();
    });

    it('closes MobileFilterModal when modal onClose called', () => {
      render(<MobileOrdersList orders={[]} isLoading={false} operatorId="op-1" />);
      fireEvent.click(screen.getByTestId('filter-btn'));
      expect(screen.getByTestId('mobile-filter-modal')).toBeTruthy();
      fireEvent.click(screen.getByText('Cerrar modal'));
      expect(screen.queryByTestId('mobile-filter-modal')).toBeNull();
    });
  });

  // ── 10. statusFilter integration ─────────────────────────────────────────

  describe('statusFilter integration', () => {
    it('shows only urgent group when statusFilter=urgent', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'urgent',
      });
      const urgentEnd = new Date(Date.now() + 30 * 60000).toISOString();
      const orders = [
        makeOrder({ id: 'u1', delivery_window_end: urgentEnd }),
        makeOrder({ id: 'ok1', delivery_window_end: null }),
      ];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('order-card-u1')).toBeTruthy();
      expect(screen.queryByTestId('order-card-ok1')).toBeNull();
    });

    it('shows all groups when statusFilter=all', () => {
      const urgentEnd = new Date(Date.now() + 30 * 60000).toISOString();
      const orders = [
        makeOrder({ id: 'u1', delivery_window_end: urgentEnd }),
        makeOrder({ id: 'ok1', delivery_window_end: null }),
      ];
      render(<MobileOrdersList orders={orders} isLoading={false} operatorId="op-1" />);
      expect(screen.getByTestId('order-card-u1')).toBeTruthy();
      expect(screen.getByTestId('order-card-ok1')).toBeTruthy();
    });
  });
});
