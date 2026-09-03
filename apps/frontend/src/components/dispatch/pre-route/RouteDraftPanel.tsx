'use client';

import { cn } from '@/lib/utils';
import type { SelectionSummary, UnroutedGroup } from '@/hooks/dispatch/pre-route/useUnroutedGroups';

/**
 * spec-54 phase 4.2 / spec-75 Task 2a — "Ruta en armado" (right column).
 *
 * The mock shows a driver card, a vehicle occupancy bar and a numbered stop
 * sequence with per-stop ETAs. Those belong to a route that exists: the
 * assignment lives on /app/dispatch/[routeId], and the stop sequence needs the
 * optimiser. Before "Armar ruta" there is no route and no sequence.
 *
 * So this panel shows what the route *will* contain and says plainly where the
 * rest happens, rather than rendering an empty driver card and a stop list of
 * placeholders.
 *
 * spec-75: selection moved from the group to the order, so this now lists the
 * selected orders themselves (not the groups they belong to) — a group that
 * is only partially selected would otherwise show its full, unselected
 * totals here, which is what the old group-level list did.
 */

interface RouteDraftPanelProps {
  groups: UnroutedGroup[];
  selectedOrderIds: Set<string>;
  summary: SelectionSummary;
  onBuildRoute: () => void;
  onClear: () => void;
  isBuilding?: boolean;
}

export function RouteDraftPanel({
  groups,
  selectedOrderIds,
  summary,
  onBuildRoute,
  onClear,
  isBuilding = false,
}: RouteDraftPanelProps) {
  const selectedOrders = groups
    .flatMap((g) => g.orders)
    .filter((o) => selectedOrderIds.has(o.id));

  return (
    <aside className="flex min-h-0 flex-col border-border bg-surface lg:border-l">
      <header className="flex flex-none items-center gap-2 border-b border-border px-4 py-3.5">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Ruta en armado
        </h2>
        <span
          className={cn(
            'ml-auto rounded-sm border px-1.5 py-[3px] font-mono text-[9.5px] font-semibold leading-none',
            summary.orderCount > 0
              ? 'border-accent bg-accent-muted text-accent'
              : 'border-border bg-surface-raised text-text-muted',
          )}
        >
          BORRADOR
        </span>
      </header>

      {summary.orderCount === 0 ? (
        <p className="flex-1 px-4 py-10 text-center text-[12.5px] leading-normal text-text-secondary">
          Selecciona una o más órdenes para armar una ruta.
        </p>
      ) : (
        <>
          <div className="grid flex-none grid-cols-2 gap-x-4 gap-y-3 border-b border-border px-4 py-3.5">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted">
                Órdenes
              </span>
              <span
                data-testid="draft-order-count"
                className="font-mono text-[17px] font-bold leading-none text-text"
              >
                {summary.orderCount}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted">
                Paquetes
              </span>
              <span
                data-testid="draft-package-count"
                className="font-mono text-[17px] font-bold leading-none text-text"
              >
                {summary.packageCount}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="px-4 pb-2 pt-3 font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted">
              Órdenes en la ruta
            </p>
            {selectedOrders.map((order, i) => (
              <div
                key={order.id}
                data-testid="draft-order"
                className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5"
              >
                <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-surface-raised font-mono text-[10px] font-semibold text-text-secondary">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-mono text-[11.5px] font-semibold leading-none text-text">
                    {order.orderNumber}
                  </span>
                  <span className="truncate text-[10px] leading-none text-text-muted">
                    {order.comunaName} · {order.packageCount} paquetes
                  </span>
                </span>
              </div>
            ))}

            <p className="px-4 py-3 text-[11px] leading-[1.5] text-text-muted">
              El conductor, el vehículo y el orden de las paradas se asignan al
              abrir la ruta, después de armarla.
            </p>
          </div>
        </>
      )}

      <footer className="flex flex-none gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onClear}
          disabled={summary.orderCount === 0}
          className="h-[34px] flex-1 rounded-lg border border-border-strong text-xs font-semibold text-text-body transition-colors hover:bg-surface-raised disabled:opacity-40"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={onBuildRoute}
          disabled={summary.orderCount === 0 || isBuilding}
          className="h-[34px] flex-1 rounded-lg bg-accent-light text-xs font-semibold text-accent-light-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isBuilding ? 'Armando…' : 'Armar ruta'}
        </button>
      </footer>
    </aside>
  );
}
