'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GroupBy, SelectionSummary, UnroutedGroup } from '@/hooks/dispatch/pre-route/useUnroutedGroups';

/**
 * spec-54 phase 4.2 — "Órdenes sin rutear" (mock 1c, left column).
 *
 * The whole row is the hit target, not just the checkbox: this is used at
 * speed, and a 16px box is a small thing to hit repeatedly.
 */

interface UnroutedColumnProps {
  groups: UnroutedGroup[];
  groupBy: GroupBy;
  onGroupByChange: (next: GroupBy) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  summary: SelectionSummary;
  onBuildRoute: () => void;
  isBuilding?: boolean;
}

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'anden', label: 'Por andén' },
  { value: 'comuna', label: 'Por comuna' },
];

export function UnroutedColumn({
  groups,
  groupBy,
  onGroupByChange,
  selectedIds,
  onToggle,
  summary,
  onBuildRoute,
  isBuilding = false,
}: UnroutedColumnProps) {
  const totalOrders = groups.reduce((sum, g) => sum + g.orderCount, 0);

  return (
    <section className="flex min-h-0 flex-col border-border bg-surface lg:border-r">
      <header className="flex flex-none flex-col gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
            Órdenes sin rutear
          </h2>
          <span className="ml-auto font-mono text-[11px] font-semibold leading-none text-text-secondary">
            {totalOrders}
          </span>
        </div>

        <div className="flex gap-1">
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
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">
            No hay órdenes listas para rutear con estos filtros.
          </p>
        ) : (
          groups.map((group) => {
            const selected = selectedIds.has(group.id);
            return (
              <button
                key={group.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                data-testid="unrouted-group"
                onClick={() => onToggle(group.id)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-l-[3px] border-border-subtle px-4 py-3 text-left transition-colors',
                  selected
                    ? 'border-l-accent bg-accent-muted'
                    : 'border-l-transparent hover:bg-surface-raised',
                )}
              >
                <span
                  className={cn(
                    'grid h-4 w-4 flex-none place-items-center rounded border',
                    selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
                  )}
                >
                  {selected && <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3} />}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold leading-none text-text">
                      {group.name}
                    </span>
                    {group.warning && (
                      <AlertTriangle
                        className="h-3 w-3 flex-none text-status-warning-text"
                        aria-label="Repartida entre varios andenes"
                      />
                    )}
                  </span>
                  <span className="truncate text-[10.5px] leading-none text-text-muted">
                    {group.orderCount} órdenes · {group.packageCount} paquetes
                    {group.subtitle ? ` · ${group.subtitle}` : ''}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <footer className="flex flex-none flex-col gap-2.5 border-t border-border bg-background px-4 py-3">
        <span className="font-mono text-[10.5px] leading-none text-text-secondary">
          {summary.orderCount} seleccionadas / {summary.packageCount} paquetes ·{' '}
          {summary.comunaCount} {summary.comunaCount === 1 ? 'comuna' : 'comunas'}
        </span>
        <button
          type="button"
          onClick={onBuildRoute}
          disabled={summary.groupCount === 0 || isBuilding}
          className="h-[34px] rounded-lg bg-accent-light text-xs font-semibold text-accent-light-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isBuilding ? 'Armando…' : 'Armar ruta'}
        </button>
      </footer>
    </section>
  );
}
