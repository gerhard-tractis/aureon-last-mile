"use client";

import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';
import { StatusBadge } from '@/components/StatusBadge';

export interface MobileOrderCardProps {
  order: OperationsOrder;
  priority: OrderPriority;
  onView: () => void;
  onEscalar?: () => void;
}

const PRIORITY_DOT: Record<OrderPriority, string> = {
  urgent: 'bg-[var(--color-status-error)]',
  alert: 'bg-[var(--color-status-warning)]',
  ok: 'bg-[var(--color-status-success)]',
  late: 'bg-border',
};

function getCountdownText(deliveryWindowEnd: string): string {
  const end = new Date(deliveryWindowEnd).getTime();
  const now = Date.now();
  const diffMs = end - now;
  if (diffMs <= 0) return 'Pasado';
  const diffMin = Math.floor(diffMs / (1000 * 60));
  return `En ${diffMin}m`;
}

export function MobileOrderCard({ order, priority, onView, onEscalar }: MobileOrderCardProps) {
  const dotColor = PRIORITY_DOT[priority];
  const showEscalar = priority === 'late' && !!onEscalar;
  const hasCountdown = !!order.delivery_window_end;
  const countdownText = hasCountdown ? getCountdownText(order.delivery_window_end!) : null;

  return (
    <div className="bg-surface border border-border rounded-md p-3 min-h-[48px]">
      {/* Row 1: priority dot + order number + status badge */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            data-testid="priority-dot"
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`}
          />
          <span className="font-bold text-sm font-mono text-text">{order.order_number}</span>
        </div>
        <StatusBadge status={order.status} size="sm" />
      </div>

      {/* Row 2: retailer · comuna */}
      <p className="text-xs text-text-muted mb-1">
        {order.retailer_name ?? ''} · {order.comuna}
      </p>

      {/* Row 3: countdown */}
      {hasCountdown && (
        <span
          data-testid="countdown"
          className={`text-xs font-mono font-medium ${
            countdownText === 'Pasado'
              ? 'text-[var(--color-status-error)]'
              : 'text-text-muted'
          } ${priority === 'urgent' ? 'animate-pulse' : ''}`}
        >
          {countdownText}
        </span>
      )}

      {/* Row 4: action buttons — 48px min touch target */}
      <div className="flex gap-2 mt-2 items-center">
        <button
          type="button"
          data-testid="btn-ver"
          onClick={onView}
          className="min-h-[48px] min-w-[48px] text-xs bg-accent/10 text-accent px-3 rounded-md font-medium"
        >
          Ver
        </button>
        {showEscalar && (
          <button
            type="button"
            data-testid="btn-escalar"
            onClick={onEscalar}
            className="min-h-[48px] min-w-[48px] text-xs bg-[var(--color-status-error-bg)] text-[var(--color-status-error)] px-3 rounded-md font-medium"
          >
            Escalar
          </button>
        )}
      </div>
    </div>
  );
}
