'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, Check, Minus, PackageSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import {
  groupSelectionState,
  type GroupBy,
  type SelectionSummary,
  type UnroutedGroup,
} from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import { sortOrdersByWindow, urgentOrderIds } from '@/lib/dispatch/pre-route-order-urgency';
import { UnroutedOrderRow } from './UnroutedOrderRow';

/**
 * spec-54 phase 4.2 — "Órdenes sin rutear" (left column).
 *
 * One row per order, grouped under a group header. The group header is a
 * shortcut checkbox (toggles every order under it) rather than a selectable
 * unit of its own; the whole order row is a click target, not just its
 * checkbox — this is used at speed, at a warehouse desk.
 */

interface UnroutedColumnProps {
  groups: UnroutedGroup[];
  groupBy: GroupBy;
  onGroupByChange: (next: GroupBy) => void;
  selectedOrderIds: Set<string>;
  onToggleOrder: (orderId: string) => void;
  onToggleGroup: (group: UnroutedGroup) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  summary: SelectionSummary;
  onBuildRoute: () => void;
  isBuilding?: boolean;
}

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'anden', label: 'Por andén' },
  { value: 'comuna', label: 'Por comuna' },
];

function GroupHeaderRow({
  group,
  selectedOrderIds,
  onToggleGroup,
}: {
  group: UnroutedGroup;
  selectedOrderIds: Set<string>;
  onToggleGroup: (group: UnroutedGroup) => void;
}) {
  const state = groupSelectionState(group, selectedOrderIds);

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
      data-testid={`unrouted-group-${group.id}`}
      onClick={() => onToggleGroup(group)}
      className={cn(
        'flex w-full items-center gap-3 border-b border-l-[3px] border-border-subtle bg-surface-raised/60 px-4 py-2 text-left transition-colors hover:bg-surface-raised',
        state === 'none' ? 'border-l-transparent' : 'border-l-accent',
      )}
    >
      <span
        className={cn(
          'grid h-4 w-4 flex-none place-items-center rounded border',
          state === 'none' ? 'border-border-strong bg-surface' : 'border-accent bg-accent',
        )}
      >
        {state === 'some' && <Minus className="h-3 w-3 text-accent-light-foreground" strokeWidth={3} />}
        {state === 'all' && <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3} />}
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-[12px] font-semibold leading-none text-text">{group.name}</span>
        {group.warning && (
          <AlertTriangle
            className="h-3 w-3 flex-none text-status-warning-text"
            aria-label="Repartida entre varios andenes"
          />
        )}
        <span className="ml-auto truncate text-[10px] leading-none text-text-muted">
          {group.orderCount} órdenes · {group.packageCount} paquetes
          {group.subtitle ? ` · ${group.subtitle}` : ''}
        </span>
      </span>
    </button>
  );
}

export function UnroutedColumn({
  groups,
  groupBy,
  onGroupByChange,
  selectedOrderIds,
  onToggleOrder,
  onToggleGroup,
  onSelectAll,
  onClearSelection,
  summary,
  onBuildRoute,
  isBuilding = false,
}: UnroutedColumnProps) {
  // group.orderCount (the RPC's own count) is the single source of truth for
  // this total — summing g.orders.length here as well would give the same
  // number a second, independent way to drift out of sync with it.
  const totalOrders = groups.reduce((sum, g) => sum + g.orderCount, 0);

  // spec-75 task 2b — the fixed Mañana/Tarde/Noche filter tabs are gone;
  // the delivery window is now a sortable column with an urgency chip
  // instead, since planning tools should treat it as a constraint to
  // respect, not something that hides orders out of the list. Sort only
  // ever reorders rows *within* a group — it never moves an order across
  // groups. Urgency is computed once across every visible order (not per
  // group), so "sooner than others" compares against the whole column.
  const [sortByWindow, setSortByWindow] = useState(false);
  const urgentIds = useMemo(
    () => urgentOrderIds(groups.flatMap((g) => g.orders)),
    [groups],
  );
  const displayGroups = useMemo(
    () =>
      sortByWindow
        ? groups.map((g) => ({ ...g, orders: sortOrdersByWindow(g.orders) }))
        : groups,
    [groups, sortByWindow],
  );

  // I5 — selection lives at the order level and outlives filtering: narrow
  // the comuna/andén/cliente filters and an order selected earlier can
  // simply no longer be in `groups`. `summary.orderCount` only counts
  // selected orders that are still visible, so the gap against the full
  // `selectedOrderIds` set is exactly what's ticked but currently hidden.
  // Silently building the route would still be correct (it only ever uses
  // the visible `summary.orderIds`) — but the operator has no way to know
  // 37 other orders are still selected until the filters clear and they
  // reappear, possibly after already being routed. Surface it instead of
  // pruning: pruning on every filter change would look like the tool
  // silently discarding a selection the operator made on purpose.
  const hiddenSelectedCount = selectedOrderIds.size - summary.orderCount;

  return (
    <section className="flex min-h-0 flex-col border-border bg-surface lg:border-r">
      <header className="flex flex-none flex-col gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
            Órdenes sin rutear
          </h2>
          <span
            data-testid="unrouted-total"
            className="ml-auto font-mono text-[11px] font-semibold leading-none text-text-secondary"
          >
            {totalOrders}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={groupBy === opt.value}
              onClick={() => onGroupByChange(opt.value)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] leading-none transition-colors',
                groupBy === opt.value
                  ? 'bg-surface-raised font-semibold text-text'
                  : 'text-text-secondary hover:bg-surface-raised',
              )}
            >
              {opt.label}
            </button>
          ))}

          <button
            type="button"
            aria-pressed={sortByWindow}
            onClick={() => setSortByWindow((v) => !v)}
            className={cn(
              'ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] leading-none transition-colors',
              sortByWindow
                ? 'bg-surface-raised font-semibold text-text'
                : 'text-text-secondary hover:bg-surface-raised',
            )}
          >
            <ArrowUpDown className="h-3 w-3" aria-hidden />
            Ventana
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {displayGroups.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="Nada que rutear"
            description="No hay órdenes listas para rutear con estos filtros."
          />
        ) : (
          displayGroups.map((group) => (
            <div key={group.id}>
              <GroupHeaderRow group={group} selectedOrderIds={selectedOrderIds} onToggleGroup={onToggleGroup} />
              {group.orders.map((order) => (
                <UnroutedOrderRow
                  key={order.id}
                  order={order}
                  selected={selectedOrderIds.has(order.id)}
                  onToggle={onToggleOrder}
                  urgent={urgentIds.has(order.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <footer className="flex flex-none flex-col gap-2 border-t border-border bg-background px-4 py-3">
        <span className="font-mono text-[10.5px] leading-none text-text-secondary">
          {summary.orderCount} seleccionadas · {summary.packageCount} paquetes ·{' '}
          {summary.comunaCount} {summary.comunaCount === 1 ? 'comuna' : 'comunas'}
        </span>

        {hiddenSelectedCount > 0 && (
          <span
            data-testid="unrouted-hidden-selected"
            className="font-mono text-[10.5px] leading-none text-status-warning-text"
          >
            {hiddenSelectedCount} seleccionadas ocultas por los filtros actuales
          </span>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            disabled={totalOrders === 0}
            className="h-7 flex-1 text-[10.5px]"
          >
            Seleccionar todo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearSelection}
            className="h-7 flex-1 text-[10.5px]"
          >
            Limpiar selección
          </Button>
        </div>

        <button
          type="button"
          onClick={onBuildRoute}
          disabled={summary.orderCount === 0 || isBuilding}
          className="h-[34px] rounded-lg bg-accent-light text-xs font-semibold text-accent-light-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isBuilding ? 'Armando…' : 'Armar ruta'}
        </button>
      </footer>
    </section>
  );
}
