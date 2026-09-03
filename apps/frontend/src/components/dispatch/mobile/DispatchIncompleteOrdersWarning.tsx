'use client';

import { AlertTriangle } from 'lucide-react';
import type { IncompleteOrder } from '@/lib/dispatch/mobile/route-load-brief';

/**
 * spec-76 2c / decision 5 — the pre-scan warning for an order with a
 * sibling package `retenido` (held in consolidation). Names the real
 * consequence rather than just the state, and lists the `ORD-…` codes.
 */
export interface DispatchIncompleteOrdersWarningProps {
  orders: IncompleteOrder[];
}

export function DispatchIncompleteOrdersWarning({ orders }: DispatchIncompleteOrdersWarningProps) {
  if (orders.length === 0) return null;
  return (
    <div
      className="rounded-[10px] border border-status-warning-border bg-status-warning-bg p-3.5"
      data-testid="dispatch-incomplete-orders-warning"
    >
      <p className="flex items-start gap-2 text-[13px] text-status-warning-text">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <span>
          Les falta un paquete que está en consolidación. Si las cargas igual, el cliente recibe en dos
          visitas.
        </span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {orders.map((o) => (
          <li
            key={o.orderId}
            className="rounded-full border border-status-warning-border px-2 py-0.5 font-mono text-[11px] font-semibold text-status-warning-text"
          >
            {o.orderNumber}
          </li>
        ))}
      </ul>
    </div>
  );
}
