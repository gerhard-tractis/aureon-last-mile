'use client';

/**
 * OrdersTable
 * Full orders table with pagination and client-side filtering.
 */

import { useState } from 'react';
import { useOperationsOrders } from '@/hooks/useOperationsOrders';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import type { OrderPriority } from '@/lib/types/pipeline';
import { OrdersTableRow } from './OrdersTableRow';

export interface OrdersTableProps {
  operatorId: string;
  onOpenDetail: (orderId: string) => void;
}

const PAGE_SIZE = 25;

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

function sortByDeadline(orders: OperationsOrder[]): OperationsOrder[] {
  return [...orders].sort((a, b) => {
    const priorityA = computePriority(a);
    const priorityB = computePriority(b);
    // Late orders go to bottom
    const isLateA = priorityA === 'late' ? 1 : 0;
    const isLateB = priorityB === 'late' ? 1 : 0;
    if (isLateA !== isLateB) return isLateA - isLateB;
    // Sort by delivery_window_end ascending (soonest first), nulls last
    if (!a.delivery_window_end && !b.delivery_window_end) return 0;
    if (!a.delivery_window_end) return 1;
    if (!b.delivery_window_end) return -1;
    return new Date(a.delivery_window_end).getTime() - new Date(b.delivery_window_end).getTime();
  });
}

// --- Component ---

export function OrdersTable({ operatorId, onOpenDetail }: OrdersTableProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { search, datePreset, statusFilter, stageFilter } = useOpsControlFilterStore();

  const { data, isLoading, isError } = useOperationsOrders(operatorId, {
    datePreset,
    dateRange: null,
    statusFilter,
    stageFilter,
  });

  if (isLoading) {
    return (
      <div data-testid="orders-table-loading" className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="orders-table-error"
        className="p-8 text-center text-red-600 font-medium"
      >
        Error al cargar pedidos
      </div>
    );
  }

  const rawOrders = data ?? [];
  const afterStatus = applyStatusFilter(rawOrders, statusFilter);
  const afterSearch = applySearch(afterStatus, search);
  const sorted = sortByDeadline(afterSearch);

  if (sorted.length === 0) {
    return (
      <div
        data-testid="orders-table-empty"
        className="p-8 text-center text-gray-500"
      >
        No hay órdenes que coincidan.{' '}
        <button
          className="text-blue-600 hover:underline"
          onClick={() => useOpsControlFilterStore.getState().clearAllFilters()}
        >
          Limpiar filtros
        </button>
      </div>
    );
  }

  const visibleOrders = sorted.slice(0, visibleCount);
  const hasMore = sorted.length > visibleCount;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2">Pedido</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Destino</th>
              <th className="px-3 py-2">Promesa</th>
              <th className="px-3 py-2">Ventana</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-center">Parcial</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((order) => (
              <OrdersTableRow
                key={order.id}
                order={order}
                priority={computePriority(order)}
                onOpenDetail={onOpenDetail}
              />
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            data-testid="load-more-btn"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cargar más ({sorted.length - visibleCount} restantes)
          </button>
        </div>
      )}
    </div>
  );
}
