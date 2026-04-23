import React, { useState } from 'react';
import type { PreRouteComuna } from '@/lib/types';
import { OrderList } from './OrderList';

type Props = { comunas: PreRouteComuna[] };

export function ComunaBreakdown({ comunas }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleComuna(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="border-t border-border bg-muted/30">
      {comunas.map((comuna) => (
        <div key={comuna.id}>
          <button
            type="button"
            onClick={() => toggleComuna(comuna.id)}
            className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted/50 transition-colors"
          >
            <span className="font-medium">{comuna.name}</span>
            <span className="text-muted-foreground text-xs">
              {comuna.order_count} órd · {comuna.package_count} bultos
            </span>
          </button>
          {expanded.has(comuna.id) && <OrderList orders={comuna.orders} />}
        </div>
      ))}
    </div>
  );
}
