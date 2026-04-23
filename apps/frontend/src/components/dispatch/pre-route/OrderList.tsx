import React from 'react';
import type { PreRouteOrder } from '@/lib/types';

function formatWindow(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

type Props = { orders: PreRouteOrder[] };

export function OrderList({ orders }: Props) {
  if (orders.length === 0) return null;

  return (
    <ul className="divide-y divide-border">
      {orders.map((order) => {
        const window = formatWindow(order.delivery_window_start, order.delivery_window_end);
        return (
          <li key={order.id} className="flex items-start gap-3 px-4 py-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">
              {order.order_number}
            </span>
            <span className="flex-1 min-w-0">
              <span className="font-medium truncate block">{order.customer_name}</span>
              <span className="text-muted-foreground truncate block">{order.delivery_address}</span>
            </span>
            <span className="text-muted-foreground text-xs shrink-0">
              {window ?? '—'}
            </span>
            <span className="text-muted-foreground text-xs shrink-0">
              {order.package_count} bulto{order.package_count !== 1 ? 's' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
