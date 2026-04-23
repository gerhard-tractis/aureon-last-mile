'use client';

import React from 'react';
import type { PreRouteAnden } from '@/lib/types';

type Props = {
  andenes: PreRouteAnden[];
  selectedAndenIds: Set<string>;
  onCreateRoute: (orderIds: string[]) => void;
  onClear: () => void;
};

export function PreRouteSelectionBar({ andenes, selectedAndenIds, onCreateRoute, onClear }: Props) {
  if (selectedAndenIds.size === 0) return null;

  const selected = andenes.filter((a) => selectedAndenIds.has(a.id));
  const totalOrders = selected.reduce((sum, a) => sum + a.order_count, 0);
  const totalPackages = selected.reduce((sum, a) => sum + a.package_count, 0);
  const mergedIds = selected.flatMap((a) => a.order_ids);
  const isMulti = selected.length >= 2;

  const actionLabel = isMulti
    ? `Crear ruta combinada (${selected.length} andenes)`
    : 'Crear ruta con selección';

  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <span aria-live="polite" className="text-sm font-medium">
          {totalOrders} órd · {totalPackages} bultos
        </span>
        {isMulti && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Una sola ruta con órdenes de varios andenes. Úsalo solo cuando haga falta completar capacidad.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={() => onCreateRoute(mergedIds)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
