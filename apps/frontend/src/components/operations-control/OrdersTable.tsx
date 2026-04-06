'use client';

/**
 * OrdersTable (spec-13c redesign)
 * Uses DataTable compound component with filter chips from the ops control store.
 */

import { useMemo } from 'react';
import { useOperationsOrders } from '@/hooks/useOperationsOrders';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import { useOpsControlFilterStore } from '@/lib/stores/useOpsControlFilterStore';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import type { FilterChip } from '@/components/data-table/DataTableToolbar';
import { StatusBadge } from '@/components/StatusBadge';
import type { OrderPriority } from '@/lib/types/pipeline';

export interface OrdersTableProps {
  operatorId: string;
  onOpenDetail: (orderId: string) => void;
}

// --- Pure helper functions (exported for testing convenience) ---

export function computePriority(order: OperationsOrder): OrderPriority {
  if (!order.delivery_window_end) return 'ok';
  const endMs = new Date(order.delivery_window_end).getTime();
  const now = Date.now();
  const diffMin = (endMs - now) / 60000;
  if (diffMin < 0) return 'late';
  if (diffMin < 30) return 'urgent';
  if (diffMin < 90) return 'alert';
  return 'ok';
}

export function applyStatusFilter(
  orders: OperationsOrder[],
  statusFilter: string,
): OperationsOrder[] {
  if (statusFilter === 'all') return orders;
  return orders.filter((o) => computePriority(o) === statusFilter);
}

export function applySearch(orders: OperationsOrder[], search: string): OperationsOrder[] {
  if (!search.trim()) return orders;
  const q = search.toLowerCase();
  return orders.filter(
    (o) =>
      o.order_number.toLowerCase().includes(q) ||
      (o.retailer_name?.toLowerCase() ?? '').includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.comuna.toLowerCase().includes(q),
  );
}

function formatTimeWindow(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const now = Date.now();
  const endMs = new Date(end).getTime();
  const diffMs = endMs - now;
  if (diffMs <= 0) {
    const pastMin = Math.floor(-diffMs / 60000);
    return `Pasado ${Math.floor(pastMin / 60)}h ${pastMin % 60}m`;
  }
  const min = Math.floor(diffMs / 60000);
  return `En ${Math.floor(min / 60)}h ${min % 60}m`;
}

// --- Columns ---

type OrderRow = OperationsOrder & Record<string, unknown>;

const columns: ColumnDef<OrderRow>[] = [
  {
    accessorKey: 'order_number',
    header: 'Orden',
    className: 'font-mono',
  },
  {
    accessorKey: 'customer_name',
    header: 'Cliente',
    cell: (row) => row.retailer_name ?? row.customer_name,
  },
  {
    accessorKey: 'comuna',
    header: 'Comuna',
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: (row) => <StatusBadge status={row.status} size="sm" />,
    sortable: false,
  },
  {
    accessorKey: 'delivery_window_end',
    header: 'Hora',
    className: 'font-mono',
    cell: (row) => formatTimeWindow(row.delivery_window_start as string | null, row.delivery_window_end as string | null),
  },
];

// --- Component ---

export function OrdersTable({ operatorId, onOpenDetail }: OrdersTableProps) {
  const { statusFilter, datePreset, dateRange, stageFilter, setStatusFilter, clearAllFilters } =
    useOpsControlFilterStore();

  const { data, isLoading, isError } = useOperationsOrders(operatorId, {
    datePreset,
    dateRange,
    statusFilter,
    stageFilter,
  });

  const filteredData = useMemo(() => {
    const rawOrders = data ?? [];
    return applyStatusFilter(rawOrders, statusFilter) as OrderRow[];
  }, [data, statusFilter]);

  const filterChips: FilterChip[] = useMemo(
    () => [
      {
        key: 'urgent',
        label: 'Urgentes',
        active: statusFilter === 'urgent',
        onToggle: () => setStatusFilter(statusFilter === 'urgent' ? 'all' : 'urgent'),
      },
      {
        key: 'alert',
        label: 'Alertas',
        active: statusFilter === 'alert',
        onToggle: () => setStatusFilter(statusFilter === 'alert' ? 'all' : 'alert'),
      },
      {
        key: 'ok',
        label: 'OK',
        active: statusFilter === 'ok',
        onToggle: () => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok'),
      },
      {
        key: 'late',
        label: 'Atrasados',
        active: statusFilter === 'late',
        onToggle: () => setStatusFilter(statusFilter === 'late' ? 'all' : 'late'),
      },
    ],
    [statusFilter, setStatusFilter],
  );

  if (isError) {
    return (
      <div
        data-testid="orders-table-error"
        className="p-8 text-center text-[var(--color-status-error)] font-medium"
      >
        Error al cargar pedidos.{' '}
        <button className="underline" onClick={() => clearAllFilters()}>
          Limpiar filtros
        </button>
      </div>
    );
  }

  return (
    <DataTable<OrderRow>
      columns={columns}
      data={filteredData}
      isLoading={isLoading}
      filterChips={filterChips}
      searchPlaceholder="Buscar orden, cliente, comuna..."
      onRowClick={(row) => onOpenDetail(row.id)}
      emptyMessage="No hay órdenes que coincidan"
    />
  );
}
