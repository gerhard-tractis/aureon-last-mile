/**
 * Tests for OrdersTable component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrdersTable, computePriority, applyStatusFilter, applySearch } from './OrdersTable';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';

// --- Mock DataTable (renders a simple table from columns/data) ---
vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: vi.fn(({ columns, data, isLoading, onRowClick, emptyMessage }: any) => {
    if (isLoading) return <div data-testid="orders-table-loading">Loading...</div>;
    if (data.length === 0) return <div data-testid="orders-table-empty">{emptyMessage}</div>;
    return (
      <table data-testid="orders-data-table">
        <tbody>
          {data.map((row: any) => (
            <tr key={row.id} onClick={() => onRowClick?.(row)} data-testid={`row-${row.id}`}>
              <td>{row.order_number}</td>
              <td>{row.customer_name}</td>
              <td>{row.comuna}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

// --- Mock hooks ---
vi.mock('@/hooks/useOperationsOrders', () => ({
  useOperationsOrders: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
}));

vi.mock('@/lib/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => ({
    search: '',
    datePreset: 'today',
    dateRange: null,
    statusFilter: 'all',
    stageFilter: null,
    setSearch: vi.fn(),
    setDatePreset: vi.fn(),
    setDateRange: vi.fn(),
    setStatusFilter: vi.fn(),
    setStageFilter: vi.fn(),
    clearAllFilters: vi.fn(),
  })),
}));

import { useOperationsOrders } from '@/hooks/useOperationsOrders';
import { useOpsControlFilterStore } from '@/lib/stores/useOpsControlFilterStore';

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
  dateRange: null,
  statusFilter: 'all' as const,
  stageFilter: null,
  setSearch: vi.fn(),
  setDatePreset: vi.fn(),
  setDateRange: vi.fn(),
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

  describe('Client-side status filter', () => {
    it('shows all orders when statusFilter is "all"', () => {
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [
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
      const pastEnd = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago -> late
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
      const pastEnd = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago -> late
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
    it('calls onOpenDetail with the correct order id when row is clicked', () => {
      const onOpenDetail = vi.fn();
      vi.mocked(useOperationsOrders).mockReturnValue({
        data: [makeOrder({ id: 'order-abc', order_number: 'ORD-ABC' })],
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useOperationsOrders>);
      render(<OrdersTable operatorId="op-1" onOpenDetail={onOpenDetail} />);
      fireEvent.click(screen.getByTestId('row-order-abc'));
      expect(onOpenDetail).toHaveBeenCalledWith('order-abc');
    });
  });

  describe('Pure helper functions', () => {
    describe('computePriority', () => {
      it('returns "ok" when delivery_window_end is null', () => {
        expect(computePriority(makeOrder({ delivery_window_end: null }))).toBe('ok');
      });

      it('returns "late" when delivery_window_end is in the past', () => {
        const pastEnd = new Date(Date.now() - 3600000).toISOString();
        expect(computePriority(makeOrder({ delivery_window_end: pastEnd }))).toBe('late');
      });

      it('returns "urgent" when less than 30 min remain', () => {
        const soonEnd = new Date(Date.now() + 15 * 60000).toISOString();
        expect(computePriority(makeOrder({ delivery_window_end: soonEnd }))).toBe('urgent');
      });

      it('returns "alert" when between 30 and 90 min remain', () => {
        const medEnd = new Date(Date.now() + 60 * 60000).toISOString();
        expect(computePriority(makeOrder({ delivery_window_end: medEnd }))).toBe('alert');
      });

      it('returns "ok" when more than 90 min remain', () => {
        const farEnd = new Date(Date.now() + 120 * 60000).toISOString();
        expect(computePriority(makeOrder({ delivery_window_end: farEnd }))).toBe('ok');
      });
    });

    describe('applyStatusFilter', () => {
      it('returns all orders when filter is "all"', () => {
        const orders = [makeOrder({ id: '1' }), makeOrder({ id: '2' })];
        expect(applyStatusFilter(orders, 'all')).toHaveLength(2);
      });

      it('filters by computed priority', () => {
        const pastEnd = new Date(Date.now() - 3600000).toISOString();
        const orders = [
          makeOrder({ id: '1', delivery_window_end: null }),
          makeOrder({ id: '2', delivery_window_end: pastEnd }),
        ];
        const result = applyStatusFilter(orders, 'late');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('2');
      });
    });

    describe('applySearch', () => {
      it('returns all orders when search is empty', () => {
        const orders = [makeOrder({ id: '1' }), makeOrder({ id: '2' })];
        expect(applySearch(orders, '')).toHaveLength(2);
      });

      it('filters by order_number', () => {
        const orders = [
          makeOrder({ id: '1', order_number: 'ORD-001' }),
          makeOrder({ id: '2', order_number: 'ORD-002' }),
        ];
        expect(applySearch(orders, 'ORD-001')).toHaveLength(1);
      });

      it('filters by customer_name (case-insensitive)', () => {
        const orders = [
          makeOrder({ id: '1', customer_name: 'Alpha' }),
          makeOrder({ id: '2', customer_name: 'Beta' }),
        ];
        expect(applySearch(orders, 'beta')).toHaveLength(1);
      });

      it('filters by retailer_name', () => {
        const orders = [
          makeOrder({ id: '1', retailer_name: 'RetailerX' }),
          makeOrder({ id: '2', retailer_name: 'RetailerY' }),
        ];
        expect(applySearch(orders, 'retailerx')).toHaveLength(1);
      });

      it('filters by comuna', () => {
        const orders = [
          makeOrder({ id: '1', comuna: 'Providencia' }),
          makeOrder({ id: '2', comuna: 'Las Condes' }),
        ];
        expect(applySearch(orders, 'las condes')).toHaveLength(1);
      });
    });
  });
});
