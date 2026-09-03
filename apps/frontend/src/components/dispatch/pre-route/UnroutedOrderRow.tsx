'use client';

import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrderPackages } from '@/hooks/dispatch/pre-route/useOrderPackages';
import type { UnroutedOrderRow as OrderRow } from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import { UnroutedOrderPackages } from './UnroutedOrderPackages';

/**
 * spec-75 Task 2a — one order row inside the "Órdenes sin rutear" column:
 * ORDEN · COMUNA · DIRECCIÓN · PQT · VENTANA, plus a chevron that fetches
 * and expands the order's packages. The whole row is the checkbox's hit
 * target — this is used at a warehouse desk — the chevron button is the one
 * carve-out, `stopPropagation`-ed so expanding doesn't also (de)select.
 */
interface UnroutedOrderRowProps {
  order: OrderRow;
  selected: boolean;
  onToggle: (orderId: string) => void;
  operatorId: string | null;
}

function formatWindow(start: string | null, end: string | null): string {
  const short = (t: string) => t.slice(0, 5);
  if (start && end) return `${short(start)}–${short(end)}`;
  if (start) return `Desde ${short(start)}`;
  if (end) return `Hasta ${short(end)}`;
  return 'Sin ventana';
}

export function UnroutedOrderRow({ order, selected, onToggle, operatorId }: UnroutedOrderRowProps) {
  const [expanded, setExpanded] = useState(false);

  const {
    data: packages,
    isLoading,
    isError,
  } = useOrderPackages(order.id, operatorId, expanded);

  return (
    <div className="border-b border-border-subtle">
      <div
        role="checkbox"
        aria-checked={selected}
        tabIndex={0}
        data-testid={`unrouted-order-${order.id}`}
        onClick={() => onToggle(order.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(order.id);
          }
        }}
        className={cn(
          'grid w-full cursor-pointer grid-cols-[16px_16px_1fr_auto] items-center gap-2 py-2 pl-4 pr-3 text-left transition-colors',
          selected ? 'bg-accent-muted' : 'hover:bg-surface-raised',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'grid h-4 w-4 flex-none place-items-center rounded border',
            selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
          )}
        >
          {selected && <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3} />}
        </span>

        <button
          type="button"
          aria-label={expanded ? 'Contraer paquetes' : 'Expandir paquetes'}
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
          <span className="flex min-w-0 items-center gap-1 truncate text-[10.5px] leading-none text-text-muted">
            <span className="flex-none">{order.comunaName}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{order.address}</span>
          </span>
        </span>

        <span className="flex flex-none items-center gap-3">
          <span className="font-mono text-[11px] leading-none text-text-secondary" title="Paquetes">
            {order.packageCount}
          </span>
          <span className="font-mono text-[10.5px] leading-none text-text-muted">
            {formatWindow(order.windowStart, order.windowEnd)}
          </span>
        </span>
      </div>

      {expanded && (
        <div className="bg-background">
          <UnroutedOrderPackages packages={packages} isLoading={isLoading} isError={isError} />
        </div>
      )}
    </div>
  );
}
