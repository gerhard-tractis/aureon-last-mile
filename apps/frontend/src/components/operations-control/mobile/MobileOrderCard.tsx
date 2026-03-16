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

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 min-h-[60px]">
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
          className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full"
        >
          {order.status}
        </span>
      </div>

      {/* Row 2: retailer · comuna */}
      <p className="text-xs text-gray-500 mb-1">
        {order.retailer_name ?? ''} · {order.comuna}
      </p>

      {/* Row 3: countdown */}
      {hasCountdown && (
        <span
          data-testid="countdown"
          className={`text-xs font-medium ${
            getCountdownText(order.delivery_window_end!) === 'Pasado'
              ? 'text-red-500'
              : 'text-gray-600'
          } ${priority === 'urgent' ? 'animate-pulse' : ''}`}
        >
          {getCountdownText(order.delivery_window_end!)}
        </span>
      )}

      {/* Row 4: action buttons */}
      <div className="flex gap-2 mt-2 min-h-[60px] items-center">
        <button
          type="button"
          data-testid="btn-ver"
          onClick={onView}
          className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-md font-medium"
        >
          Ver
        </button>
        {showEscalar && (
          <button
            type="button"
            data-testid="btn-escalar"
            onClick={onEscalar}
            className="text-xs bg-red-50 text-red-600 px-3 py-1 rounded-md font-medium"
          >
            Escalar
          </button>
        )}
      </div>
    </div>
  );
}
