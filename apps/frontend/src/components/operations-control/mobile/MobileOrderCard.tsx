"use client";

import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';
import { PRIORITY_CONFIG } from '@/lib/types/pipeline';

export interface MobileOrderCardProps {
  order: OperationsOrder;
  priority: OrderPriority;
  onView: () => void;
  onEscalar?: () => void;
}

function getCountdownText(deliveryWindowEnd: string): string {
  const end = new Date(deliveryWindowEnd).getTime();
  const now = Date.now();
  const diffMs = end - now;
  if (diffMs <= 0) return 'Pasado';
  const diffMin = Math.floor(diffMs / (1000 * 60));
  return `En ${diffMin}m`;
}

export function MobileOrderCard({ order, priority, onView, onEscalar }: MobileOrderCardProps) {
  const dotColor = PRIORITY_CONFIG[priority].dotColor;
  const showEscalar = priority === 'late' && !!onEscalar;
  const hasCountdown = !!order.delivery_window_end;
  const countdownText = hasCountdown ? getCountdownText(order.delivery_window_end!) : null;

  return (
    <div className="bg-background border border-border rounded-lg p-3 min-h-[60px]">
      {/* Row 1: priority dot + order number */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            data-testid="priority-dot"
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`}
          />
          <span className="font-bold text-sm">{order.order_number}</span>
        </div>
        <span
          data-testid="status-badge"
          className="text-xs bg-muted text-foreground px-2 py-0.5 rounded-full"
        >
          {order.status}
        </span>
      </div>

      {/* Row 2: retailer · comuna */}
      <p className="text-xs text-muted-foreground mb-1">
        {order.retailer_name ?? ''} · {order.comuna}
      </p>

      {/* Row 3: countdown */}
      {hasCountdown && (
        <span
          data-testid="countdown"
          className={`text-xs font-medium ${
            countdownText === 'Pasado'
              ? 'text-red-500'
              : 'text-muted-foreground'
          } ${priority === 'urgent' ? 'animate-pulse' : ''}`}
        >
          {countdownText}
        </span>
      )}

      {/* Row 4: action buttons */}
      <div className="flex gap-2 mt-2 min-h-[60px] items-center">
        <button
          type="button"
          data-testid="btn-ver"
          onClick={onView}
          className="min-h-[60px] text-xs bg-primary/10 text-primary px-3 rounded-md font-medium"
        >
          Ver
        </button>
        {showEscalar && (
          <button
            type="button"
            data-testid="btn-escalar"
            onClick={onEscalar}
            className="min-h-[60px] text-xs bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 px-3 rounded-md font-medium"
          >
            Escalar
          </button>
        )}
      </div>
    </div>
  );
}
