'use client';

/**
 * OrdersTableRow
 * Renders a single row in the operations orders table.
 */

import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';

export interface OrdersTableRowProps {
  order: OperationsOrder;
  priority: OrderPriority;
  onOpenDetail: (orderId: string) => void;
}

const PRIORITY_DOTS: Record<OrderPriority, string> = {
  urgent: 'bg-red-500',
  alert: 'bg-yellow-500',
  ok: 'bg-green-500',
  late: 'bg-gray-500',
};

const STATUS_COLORS: Record<string, string> = {
  ingresado: 'bg-gray-100 text-gray-700',
  verificado: 'bg-blue-100 text-blue-700',
  en_bodega: 'bg-purple-100 text-purple-700',
  asignado: 'bg-indigo-100 text-indigo-700',
  en_carga: 'bg-orange-100 text-orange-700',
  listo: 'bg-cyan-100 text-cyan-700',
  en_ruta: 'bg-yellow-100 text-yellow-700',
  entregado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
};

function formatDeliveryDate(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  if (dateStr === today) return 'Hoy';
  if (dateStr === tomorrow) return 'Mañana';
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
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

export function OrdersTableRow({ order, priority, onOpenDetail }: OrdersTableRowProps) {
  const clienteDisplay = order.retailer_name ?? order.customer_name;
  const statusColor = STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-700';
  const isParcial = order.status !== order.leading_status;

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 text-sm">
      {/* Status / Priority dot */}
      <td className="px-3 py-2 w-8">
        <span
          data-testid="priority-dot"
          className={`w-3 h-3 rounded-full inline-block ${PRIORITY_DOTS[priority]}`}
        />
      </td>

      {/* Pedido */}
      <td className="px-3 py-2 font-mono">
        <button
          onClick={() => onOpenDetail(order.id)}
          className="text-blue-600 hover:text-blue-800 hover:underline"
        >
          {order.order_number}
        </button>
      </td>

      {/* Cliente */}
      <td className="px-3 py-2" data-testid="cliente-cell">
        {clienteDisplay}
      </td>

      {/* Destino */}
      <td className="px-3 py-2" data-testid="destino-cell">
        {order.comuna}
      </td>

      {/* Promesa */}
      <td className="px-3 py-2" data-testid="delivery-date">
        {formatDeliveryDate(order.delivery_date)}
      </td>

      {/* Ventana */}
      <td className="px-3 py-2 tabular-nums" data-testid="ventana-cell">
        {formatTimeWindow(order.delivery_window_start, order.delivery_window_end)}
      </td>

      {/* Estado */}
      <td className="px-3 py-2">
        <span
          data-testid="status-badge"
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}
        >
          {order.status}
        </span>
      </td>

      {/* Parcial */}
      <td className="px-3 py-2 text-center" data-testid="parcial-cell">
        {isParcial ? '~' : '—'}
      </td>

      {/* Acciones */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onOpenDetail(order.id)}
            className="px-2 py-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
          >
            Ver
          </button>
          {(priority === 'alert' || priority === 'urgent') && (
            <button className="px-2 py-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100">
              Reasignar
            </button>
          )}
          {priority === 'late' && (
            <button className="px-2 py-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100">
              Escalar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
