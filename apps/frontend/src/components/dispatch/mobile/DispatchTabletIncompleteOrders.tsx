'use client';

import { AlertTriangle } from 'lucide-react';
import type { IncompleteOrder, OrderBoxCount } from '@/lib/dispatch/mobile/route-load-brief';

/**
 * spec-78 (`3a`) — "ÓRDENES INCOMPLETAS" with its fraction (`ORD-48177 · 2
 * de 3`), the tablet's own list rendering of the same `incompleteOrders`
 * data `DispatchIncompleteOrdersWarning` (2c) already shows as plain
 * chips. Not a rebuild of that component: same `IncompleteOrder[]`
 * (`findIncompleteOrders`, unchanged), same warning semantics — this only
 * adds the fraction from `boxCountsByOrder` (route-load-brief.ts), which
 * 2c's chips never needed. Own component because the layout (a scrollable
 * list, not wrapped chips) genuinely differs, not because the data does.
 */
export interface DispatchTabletIncompleteOrdersProps {
  orders: IncompleteOrder[];
  boxCounts: ReadonlyMap<string, OrderBoxCount>;
}

export function DispatchTabletIncompleteOrders({ orders, boxCounts }: DispatchTabletIncompleteOrdersProps) {
  if (orders.length === 0) return null;
  return (
    <section data-testid="dispatch-tablet-incomplete-orders">
      <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-[.06em] text-status-warning-text">
        <AlertTriangle className="h-3.5 w-3.5" />
        Órdenes incompletas
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {orders.map((o) => {
          const counts = boxCounts.get(o.orderId);
          return (
            <li
              key={o.orderId}
              className="flex items-center justify-between rounded-md border border-status-warning-border bg-status-warning-bg px-2.5 py-1.5 font-mono text-[12px] font-semibold text-status-warning-text"
            >
              <span>{o.orderNumber}</span>
              {counts && <span>{counts.loaded} de {counts.total}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
