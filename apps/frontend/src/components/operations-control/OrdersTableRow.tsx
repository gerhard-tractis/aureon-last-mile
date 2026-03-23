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
  urgent: 'bg-status-error',
  alert: 'bg-status-warning',
  ok: 'bg-status-success',
  late: 'bg-text-muted',
};

const STATUS_COLORS: Record<string, string> = {
  ingresado: 'bg-surface-raised text-text-secondary',
  verificado: 'bg-status-info-bg text-status-info',
  en_bodega: 'bg-accent-muted text-accent',
  asignado: 'bg-accent-muted text-accent',
  en_carga: 'bg-status-warning-bg text-status-warning',
  listo: 'bg-status-info-bg text-status-info',
  en_ruta: 'bg-status-warning-bg text-status-warning',
  entregado: 'bg-status-success-bg text-status-success',
  cancelado: 'bg-status-error-bg text-status-error',
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
  const statusColor = STATUS_COLORS[order.status] ?? 'bg-surface-raised text-text-secondary';
  const isParcial = order.status !== order.leading_status;

  return (
    <tr className="border-b border-border hover:bg-surface-raised text-sm">
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
          className="text-accent hover:text-accent/80 hover:underline"
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
            className="px-2 py-1 text-xs text-status-info bg-status-info-bg border border-status-info-border rounded hover:bg-status-info-bg/80"
          >
            Ver
          </button>
          {(priority === 'alert' || priority === 'urgent') && (
            <button className="px-2 py-1 text-xs text-status-warning bg-status-warning-bg border border-status-warning-border rounded hover:bg-status-warning-bg/80">
              Reasignar
            </button>
          )}
          {priority === 'late' && (
            <button className="px-2 py-1 text-xs text-status-error bg-status-error-bg border border-status-error-border rounded hover:bg-status-error-bg/80">
              Escalar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
