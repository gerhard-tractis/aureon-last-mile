'use client';

/**
 * OrderFilterRail — the 230px filter panel on `/app/orders` (spec-65, mock
 * `3a`). Presentational, no fetching; always derives a fresh filters object
 * rather than mutating the one it was given (`resolvePreset` hands out
 * frozen ones). `hasPod`/`minAttempts` carry meaningful falsy values
 * (`false`/`0`) distinct from `null` — toggles read `=== true` / `!== null`.
 */

import { useState } from 'react';
import { X, ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrdersListFilters } from '@/hooks/useOrdersList';

export interface StatusFilterOption {
  status: string;
  label: string;
  count: number;
}

export interface RouteFilterOption {
  id: string;
  label: string;
}

interface OrderFilterRailProps {
  filters: OrdersListFilters;
  onFiltersChange: (filters: OrdersListFilters) => void;
  statusOptions: StatusFilterOption[];
  routeOptions: RouteFilterOption[];
  /** Injected like `resolvePreset`'s `today` param — testable, no clock disagreement. */
  today: string;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS: { key: string; label: string; days: number }[] = [
  { key: 'hoy', label: 'Hoy', days: 0 },
  { key: '7d', label: '7d', days: -6 },
  { key: '30d', label: '30d', days: -29 },
];

export function OrderFilterRail({
  filters,
  onFiltersChange,
  statusOptions,
  routeOptions,
  today,
}: OrderFilterRailProps) {
  const [addingZone, setAddingZone] = useState(false);
  const [zoneDraft, setZoneDraft] = useState('');
  // Explicit user choice, not just "matches no quick preset" — else clicking
  // "Rango" while already on "Hoy" would be a same-value no-op.
  const [rangeModeChosen, setRangeModeChosen] = useState(false);

  const activeDatePresetKey = DATE_PRESETS.find(
    (p) => filters.dateFrom === addDays(today, p.days) && filters.dateTo === today,
  )?.key;
  const isCustomRange = rangeModeChosen || !activeDatePresetKey;

  function patch(next: Partial<OrdersListFilters>) {
    onFiltersChange({ ...filters, ...next });
  }

  function toggleStatus(status: string, checked: boolean) {
    const current = filters.statuses ?? [];
    const next = checked ? [...current, status] : current.filter((s) => s !== status);
    patch({ statuses: next.length > 0 ? next : null });
  }

  function removeComuna(comuna: string) {
    const next = (filters.comunas ?? []).filter((c) => c !== comuna);
    patch({ comunas: next.length > 0 ? next : null });
  }

  function commitZoneDraft() {
    const value = zoneDraft.trim();
    if (value) {
      const existing = filters.comunas ?? [];
      if (!existing.includes(value)) patch({ comunas: [...existing, value] });
    }
    setZoneDraft('');
    setAddingZone(false);
  }

  return (
    <aside className="flex w-[230px] flex-none flex-col overflow-hidden border-r border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <span className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">
          FILTROS
        </span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-text-muted" />
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3.5">
        {/* RANGO DE FECHAS */}
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">RANGO DE FECHAS</h3>
          <div className="flex gap-1">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setRangeModeChosen(false);
                  patch({ dateFrom: addDays(today, p.days), dateTo: today });
                }}
                className={cn(
                  'flex-1 rounded-sm py-1.5 text-center text-[10.5px] font-semibold',
                  !isCustomRange && activeDatePresetKey === p.key
                    ? 'bg-surface-raised text-text'
                    : 'font-medium text-text-secondary',
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRangeModeChosen(true)}
              className={cn(
                'flex-1 rounded-sm py-1.5 text-center text-[10.5px] font-semibold',
                isCustomRange ? 'bg-surface-raised text-text' : 'font-medium text-text-secondary',
              )}
            >
              Rango
            </button>
          </div>
          {isCustomRange && (
            <div className="flex gap-1.5">
              <label className="sr-only" htmlFor="orders-filter-date-from">Desde</label>
              <input
                id="orders-filter-date-from"
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => patch({ dateFrom: e.target.value || null })}
                className="w-full rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] text-text"
              />
              <label className="sr-only" htmlFor="orders-filter-date-to">Hasta</label>
              <input
                id="orders-filter-date-to"
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) => patch({ dateTo: e.target.value || null })}
                className="w-full rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] text-text"
              />
            </div>
          )}
        </section>

        {/* ESTADO */}
        <section className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">ESTADO</h3>
          {statusOptions.map((opt) => {
            const checked = (filters.statuses ?? []).includes(opt.status);
            return (
              <label key={opt.status} className="flex items-center gap-2 text-[11.5px]">
                <input
                  type="checkbox"
                  role="checkbox"
                  checked={checked}
                  onChange={(e) => toggleStatus(opt.status, e.target.checked)}
                  aria-label={opt.label}
                  className="h-[13px] w-[13px] rounded-sm border-border-strong text-accent"
                />
                <span className={checked ? 'font-medium text-text' : 'text-text-secondary'}>
                  {opt.label}
                </span>
                <span className="ml-auto font-mono text-[10px] text-text-muted">{opt.count}</span>
              </label>
            );
          })}
        </section>

        {/* RUTA */}
        <section className="flex flex-col gap-1.5">
          <label htmlFor="orders-filter-route" className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">
            RUTA
          </label>
          <select
            id="orders-filter-route"
            value={filters.routeIds?.[0] ?? ''}
            onChange={(e) => patch({ routeIds: e.target.value ? [e.target.value] : null })}
            className="h-[30px] w-full rounded-md border border-border bg-background px-2 text-[11px] text-text"
          >
            <option value="">Todas las rutas</option>
            {routeOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </section>

        {/* COURIER / CONDUCTOR */}
        <section className="flex flex-col gap-1.5">
          <label htmlFor="orders-filter-driver" className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">
            COURIER / CONDUCTOR
          </label>
          <input
            id="orders-filter-driver"
            type="text"
            value={filters.driver ?? ''}
            onChange={(e) => patch({ driver: e.target.value.trim() ? e.target.value : null })}
            placeholder="Todos"
            className="h-[30px] w-full rounded-md border border-border bg-background px-2 text-[11px] text-text placeholder:text-text-muted"
          />
        </section>

        {/* CLIENTE / REMITENTE */}
        <section className="flex flex-col gap-1.5">
          <label htmlFor="orders-filter-client" className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">
            CLIENTE / REMITENTE
          </label>
          <input
            id="orders-filter-client"
            type="text"
            value={filters.client ?? ''}
            onChange={(e) => patch({ client: e.target.value.trim() ? e.target.value : null })}
            placeholder="Todos"
            className="h-[30px] w-full rounded-md border border-border bg-background px-2 text-[11px] text-text placeholder:text-text-muted"
          />
        </section>

        {/* ZONA / COMUNA */}
        <section className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">ZONA / COMUNA</h3>
          <div className="flex flex-wrap gap-1.5">
            {(filters.comunas ?? []).map((comuna) => (
              <span
                key={comuna}
                className="flex items-center gap-1.5 rounded-sm bg-surface-raised px-1.5 py-1 text-[10.5px] font-medium text-text"
              >
                {comuna}
                <button
                  type="button"
                  aria-label={`Quitar ${comuna}`}
                  onClick={() => removeComuna(comuna)}
                  className="text-text-muted hover:text-text"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {addingZone ? (
              <input
                type="text"
                aria-label="Nueva zona"
                autoFocus
                value={zoneDraft}
                onChange={(e) => setZoneDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitZoneDraft()}
                onBlur={commitZoneDraft}
                className="w-24 rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] text-text"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingZone(true)}
                className="flex items-center gap-1 rounded-sm border border-dashed border-border-strong px-1.5 py-1 text-[10.5px] text-text-muted"
              >
                <Plus className="h-2.5 w-2.5" /> añadir
              </button>
            )}
          </div>
        </section>

        {/* Toggles */}
        <label className="flex items-center gap-2 pt-0.5 text-[11.5px] text-text-secondary">
          <input
            type="checkbox"
            role="checkbox"
            checked={filters.hasPod === true}
            onChange={(e) => patch({ hasPod: e.target.checked ? true : null })}
            aria-label="Solo con prueba de entrega"
            className="h-[13px] w-[13px] rounded-sm border-border-strong text-accent"
          />
          Solo con prueba de entrega
        </label>
        <label className="flex items-center gap-2 text-[11.5px] text-text-secondary">
          <input
            type="checkbox"
            role="checkbox"
            checked={filters.minAttempts !== null && filters.minAttempts >= 2}
            onChange={(e) => patch({ minAttempts: e.target.checked ? 2 : null })}
            aria-label="2+ intentos de entrega"
            className="h-[13px] w-[13px] rounded-sm border-border-strong text-accent"
          />
          2+ intentos de entrega
        </label>
      </div>
    </aside>
  );
}
