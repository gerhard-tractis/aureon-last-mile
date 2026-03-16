/**
 * Tests for OrdersTable component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrdersTable } from './OrdersTable';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';

// --- Mock hooks ---
vi.mock('@/hooks/useOperationsOrders', () => ({
  useOperationsOrders: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
}));

vi.mock('@/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => ({
    search: '',
    datePreset: 'today',
    statusFilter: 'all',
    stageFilter: null,
    setSearch: vi.fn(),
    setDatePreset: vi.fn(),
    setStatusFilter: vi.fn(),
    setStageFilter: vi.fn(),
    clearAllFilters: vi.fn(),
  })),
}));

import { useOperationsOrders } from '@/hooks/useOperationsOrders';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';

// --- Helpers ---

function makeOrder(overrides: Partial<OperationsOrder> = {}): OperationsOrder {
  return {
    id: 'order-1',
    order_number: 'ORD-001',
    retailer_name: null,
    customer_name: 'Cliente A',
    comuna: 'Santiago',
    delivery_date: new Date().toISOString().split('T')[0],
    delivery_window_start: null,
    delivery_window_end: null,
    status: 'en_bodega',
    leading_status: 'en_bodega',
    status_updated_at: null,
    operator_id: 'op-1',
    deleted_at: null,
    ...overrides,
  };
}

function makeOrders(count: number): OperationsOrder[] {
  return Array.from({ length: count }, (_, i) =>
    makeOrder({
      id: `order-${i + 1}`,
      order_number: `ORD-${String(i + 1).padStart(3, '0')}`,
      customer_name: `Cliente ${i + 1}`,
      comuna: `Zona ${i + 1}`,
    }),
  );
}

const defaultStoreState = {
  search: '',
  datePreset: 'today' as const,
  statusFilter: 'all' as const,
  stageFilter: null,
  setSearch: vi.fn(),
  setDatePreset: vi.fn(),
  setStatusFilter: vi.fn(),
  setStageFilter: vi.fn(),
  clearAllFilters: vi.fn(),
};

describe('OrdersTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpsControlFilterStore).mockReturnValue(defaultStoreState);
    vi.mocked(useOperationsOrders).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useOperationsOrders>);
  });

  describe('Loading state', () => {
    it('shows loading skeleton when isLoading is true', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByTestId('orders-table-loading')).toBeTruthy();
    });
  });

  describe('Error state', () => {
    it('shows error message when isError is true', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByTestId('orders-table-error')).toHaveTextContent(
        'Error al cargar pedidos',
      );
    });
  });

  describe('Empty state', () => {
    it('shows empty message when no orders match', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByTestId('orders-table-empty')).toBeTruthy();
    });
  });

  describe('Data rows', () => {
    it('shows rows when data is present', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [makeOrder({ order_number: 'ORD-777' })],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByText('ORD-777')).toBeTruthy();
    });

    it('renders multiple rows', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: makeOrders(5),
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByText('ORD-001')).toBeTruthy();
      expect(screen.getByText('ORD-005')).toBeTruthy();
    });
  });

  describe('"Cargar más" button', () => {
    it('shows "Cargar más" when more than 25 orders are present', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: makeOrders(30),
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByTestId('load-more-btn')).toBeTruthy();
    });

    it('does not show "Cargar más" when 25 or fewer orders', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: makeOrders(25),
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.queryByTestId('load-more-btn')).toBeNull();
    });

    it('shows more rows after clicking "Cargar más"', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: makeOrders(30),
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      // Initially only 25 rows shown (ORD-026 not visible)
      expect(screen.queryByText('ORD-026')).toBeNull();
      fireEvent.click(screen.getByTestId('load-more-btn'));
      // After load more, ORD-026 should be visible
      expect(screen.getByText('ORD-026')).toBeTruthy();
    });
  });

  describe('Client-side search filter', () => {
    it('filters orders by order_number', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [
          makeOrder({ id: '1', order_number: 'ORD-001', customer_name: 'Alpha' }),
          makeOrder({ id: '2', order_number: 'ORD-002', customer_name: 'Beta' }),
        ],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        search: 'ORD-001',
      });
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByText('ORD-001')).toBeTruthy();
      expect(screen.queryByText('ORD-002')).toBeNull();
    });

    it('filters orders by customer_name', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [
          makeOrder({ id: '1', order_number: 'ORD-001', customer_name: 'Alpha', retailer_name: null }),
          makeOrder({ id: '2', order_number: 'ORD-002', customer_name: 'Beta', retailer_name: null }),
        ],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        search: 'beta',
      });
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.queryByText('ORD-001')).toBeNull();
      expect(screen.getByText('ORD-002')).toBeTruthy();
    });

    it('shows empty state when search matches nothing', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [makeOrder({ order_number: 'ORD-001', customer_name: 'Alpha' })],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        search: 'xyz-no-match',
      });
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByTestId('orders-table-empty')).toBeTruthy();
    });
  });

  describe('Client-side status filter', () => {
    it('shows all orders when statusFilter is "all"', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [
          // no window_end → priority ok
          makeOrder({ id: '1', order_number: 'ORD-001', delivery_window_end: null }),
        ],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'all',
      });
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByText('ORD-001')).toBeTruthy();
    });

    it('filters by priority "ok" — shows orders with no window_end (ok) and hides late', () => {
      const pastEnd = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago → late
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [
          makeOrder({ id: '1', order_number: 'ORD-OK', delivery_window_end: null }),
          makeOrder({ id: '2', order_number: 'ORD-LATE', delivery_window_end: pastEnd }),
        ],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'ok',
      });
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.getByText('ORD-OK')).toBeTruthy();
      expect(screen.queryByText('ORD-LATE')).toBeNull();
    });

    it('filters by priority "late" — shows only late orders', () => {
      const pastEnd = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago → late
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [
          makeOrder({ id: '1', order_number: 'ORD-OK', delivery_window_end: null }),
          makeOrder({ id: '2', order_number: 'ORD-LATE', delivery_window_end: pastEnd }),
        ],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'late',
      });
      render(<OrdersTable operatorId="op-1" onOpenDetail={vi.fn()} />);
      expect(screen.queryByText('ORD-OK')).toBeNull();
      expect(screen.getByText('ORD-LATE')).toBeTruthy();
    });
  });

  describe('onOpenDetail integration', () => {
    it('calls onOpenDetail with the correct order id when "Ver" is clicked', () => {
      const onOpenDetail = vi.fn();
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [makeOrder({ id: 'order-abc', order_number: 'ORD-ABC' })],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={onOpenDetail} />);
      fireEvent.click(screen.getByText('Ver'));
      expect(onOpenDetail).toHaveBeenCalledWith('order-abc');
    });
  });
});
