'use client';

import { memo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UnroutedOrderRow as OrderRow } from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import { UnroutedOrderPackages } from './UnroutedOrderPackages';

/**
 * One order row inside the "Órdenes sin rutear" column: ORDEN · COMUNA ·
 * DIRECCIÓN · PQT · VENTANA, plus a chevron that expands the order's
 * packages. The whole row is a click target for mouse users, but the
 * checkbox and the chevron are separate focusable sibling controls — a
 * `role="checkbox"` wrapper around a nested `<button>` strips that button
 * from the accessibility tree and is an axe `nested-interactive` violation,
 * the same trap `UnroutedColumn`'s group header avoids by keeping its
 * checkbox a plain `<button role="checkbox">` with no interactive children.
 */
interface UnroutedOrderRowProps {
  order: OrderRow;
  selected: boolean;
  onToggle: (orderId: string) => void;
  /** spec-75 task 2b — true when this order's window closes sooner than the
   *  others currently visible (see `urgentOrderIds` in useUnroutedGroups).
   *  Purely presentational — a plain `<span>`, not a button, so it adds no
   *  new node to the row's a11y tree. */
  urgent?: boolean;
}

function formatWindow(start: string | null, end: string | null): string {
  const short = (t: string) => t.slice(0, 5);
  if (start && end) return `${short(start)}–${short(end)}`;
  if (start) return `Desde ${short(start)}`;
  if (end) return `Hasta ${short(end)}`;
  return 'Sin ventana';
}

export const UnroutedOrderRow = memo(function UnroutedOrderRow({
  order,
  selected,
  onToggle,
  urgent = false,
}: UnroutedOrderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `unrouted-order-packages-${order.id}`;

  return (
    <div className="border-b border-border-subtle">
      <div
        onClick={() => onToggle(order.id)}
        className={cn(
          'grid w-full cursor-pointer grid-cols-[16px_16px_1fr_auto] items-center gap-2 py-2 pl-4 pr-3 text-left transition-colors',
          selected ? 'bg-accent-muted' : 'hover:bg-surface-raised',
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Seleccionar orden ${order.orderNumber}`}
          data-testid={`unrouted-order-${order.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(order.id);
          }}
          className={cn(
            'grid h-4 w-4 flex-none place-items-center rounded border',
            selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
          )}
        >
          {selected && <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3} />}
        </button>

        <button
          type="button"
          aria-label={expanded ? 'Contraer paquetes' : 'Expandir paquetes'}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="grid h-4 w-4 flex-none place-items-center text-text-muted hover:text-text"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[11px] font-semibold leading-none text-text">
              {order.orderNumber}
            </span>
            {order.hasSplitDockZone && (
              <AlertTriangle
                className="h-3 w-3 flex-none text-status-warning-text"
                aria-label="Orden repartida entre varios andenes"
              />
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[10.5px] leading-none text-text-muted">
            <span className="min-w-0 max-w-[45%] flex-shrink truncate">{order.comunaName}</span>
            <span aria-hidden className="flex-none">·</span>
            <span className="min-w-0 flex-1 truncate">{order.address}</span>
          </span>
        </span>

        <span className="flex flex-none items-center gap-3">
          <span
            data-testid={`unrouted-order-package-count-${order.id}`}
            className="font-mono text-[11px] leading-none text-text-secondary"
            title="Paquetes"
          >
            {order.packageCount}
          </span>
          <span
            data-testid={`unrouted-order-window-${order.id}`}
            className={cn(
              'rounded px-1 py-0.5 font-mono text-[10.5px] leading-none',
              urgent
                ? 'bg-status-error-bg text-status-error-text'
                : 'text-text-muted',
            )}
            title={urgent ? 'Ventana más próxima a cerrar' : undefined}
          >
            {formatWindow(order.windowStart, order.windowEnd)}
          </span>
        </span>
      </div>

      {expanded && (
        <div id={panelId} className="bg-background">
          <UnroutedOrderPackages orderId={order.id} />
        </div>
      )}
    </div>
  );
});
