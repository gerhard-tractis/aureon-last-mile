'use client';

import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';
import { Button } from '@/components/ui/button';

interface AtRiskBannerProps {
  orders: AtRiskOrder[];
  total: number;
  onViewAll: () => void;
}

export function AtRiskBanner({ orders, total, onViewAll }: AtRiskBannerProps) {
  const overflow = total - orders.length;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-md border bg-status-error-bg border-status-error-border text-status-error text-sm"
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-bold tabular-nums">{total}</span>
        <span className="font-medium">órdenes en riesgo</span>

        <span className="flex items-center gap-1.5">
          {orders.map((o) => (
            <span
              key={o.id}
              className="px-1.5 py-0.5 rounded-sm bg-status-error/10 font-mono text-xs tabular-nums"
            >
              {o.id}
            </span>
          ))}
        </span>

        {overflow > 0 && (
          <span className="text-xs font-medium">+ {overflow} más</span>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onViewAll}
        className="border-status-error text-status-error hover:bg-status-error-bg"
      >
        Ver todas
      </Button>
    </div>
  );
}
