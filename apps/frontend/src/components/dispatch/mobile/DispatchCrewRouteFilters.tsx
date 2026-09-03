'use client';

import type { RouteTab } from '@/lib/dispatch/mobile/crew-board';

const TABS: { value: RouteTab; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'mias', label: 'Mis rutas' },
  { value: 'listas', label: 'Listas' },
];

export interface DispatchCrewRouteFiltersProps {
  active: RouteTab;
  counts: Record<RouteTab, number>;
  onChange: (tab: RouteTab) => void;
}

/** spec-76 2b — `Todas` / `Mis rutas` / `Listas`, each with its own count.
 *  Plain native `<button>`s in a row, not a Radix `Tabs` root — this screen
 *  has no `TabsContent` panels to desynchronize (spec-76 Lecciones #4's
 *  orphaned-`aria-controls` failure needs two Tabs roots to happen; there
 *  is only ever one filter bar on this screen). */
export function DispatchCrewRouteFilters({ active, counts, onChange }: DispatchCrewRouteFiltersProps) {
  return (
    <div role="tablist" aria-label="Filtrar rutas" className="flex gap-2" data-testid="dispatch-crew-route-filters">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`min-h-[44px] rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
            active === tab.value
              ? 'border-accent bg-accent-muted text-accent-emphasis'
              : 'border-border bg-surface text-text-secondary'
          }`}
        >
          {tab.label} ({counts[tab.value]})
        </button>
      ))}
    </div>
  );
}
