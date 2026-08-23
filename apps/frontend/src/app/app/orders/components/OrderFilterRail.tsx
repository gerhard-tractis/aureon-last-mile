'use client';

/**
 * OrderFilterRail — the 230px filter panel on `/app/orders` (spec-65, mock
 * `3a`). Presentational, no fetching; always derives a fresh filters object
 * rather than mutating the one it was given (`resolvePreset` hands out
 * frozen ones). `hasPod`/`minAttempts` carry meaningful falsy values
 * (`false`/`0`) distinct from `null` — every read below is `=== true` /
 * `!== null`, never a bare truthiness check.
 *
 * The RANGO DE FECHAS and ZONA / COMUNA sections live in their own files
 * (`OrderDateRangeFilter`, `OrderComunaChipsFilter`) — both carry local UI
 * state that composed naturally as standalone components, and splitting
 * them out keeps this file under the 300-line limit.
 */

import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { OrdersListFilters } from '@/hooks/useOrdersList';
import { OrderDateRangeFilter } from './OrderDateRangeFilter';
import { OrderComunaChipsFilter } from './OrderComunaChipsFilter';

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

/**
 * `null | true | false`, not a checkbox — a checkbox can only express two
 * states, but the system produces three: the `pendientes-pod` preset sets
 * `hasPod: false` outright. A checkbox bound to `hasPod === true` cannot
 * represent that state, so toggling it twice from there would silently
 * turn it into `true`/`null` and diverge from the tab the user is still on.
 */
const POD_OPTIONS: { value: boolean | null; label: string }[] = [
  { value: null, label: 'Todos' },
  { value: true, label: 'Con POD' },
  { value: false, label: 'Sin POD' },
];

export function OrderFilterRail({
  filters,
  onFiltersChange,
  statusOptions,
  routeOptions,
  today,
}: OrderFilterRailProps) {
  function patch(next: Partial<OrdersListFilters>) {
    onFiltersChange({ ...filters, ...next });
  }

  function toggleStatus(status: string, checked: boolean) {
    const current = filters.statuses ?? [];
    const next = checked ? [...current, status] : current.filter((s) => s !== status);
    patch({ statuses: next.length > 0 ? next : null });
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
        <OrderDateRangeFilter
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          today={today}
          onChange={(range) => patch(range)}
        />

        {/* ESTADO */}
        <section className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">ESTADO</h3>
          {statusOptions.map((opt) => {
            const checked = (filters.statuses ?? []).includes(opt.status);
            return (
              <label key={opt.status} className="flex items-center gap-2 text-[11.5px]">
                <input
                  type="checkbox"
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
          <Input
            id="orders-filter-driver"
            type="text"
            value={filters.driver ?? ''}
            onChange={(e) => patch({ driver: e.target.value === '' ? null : e.target.value })}
            placeholder="Todos"
            className="h-[30px] px-2 text-[11px]"
          />
        </section>

        {/* CLIENTE / REMITENTE */}
        <section className="flex flex-col gap-1.5">
          <label htmlFor="orders-filter-client" className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">
            CLIENTE / REMITENTE
          </label>
          <Input
            id="orders-filter-client"
            type="text"
            value={filters.client ?? ''}
            onChange={(e) => patch({ client: e.target.value === '' ? null : e.target.value })}
            placeholder="Todos"
            className="h-[30px] px-2 text-[11px]"
          />
        </section>

        <OrderComunaChipsFilter comunas={filters.comunas} onChange={(comunas) => patch({ comunas })} />

        {/* Prueba de entrega — three states, see POD_OPTIONS */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">
            PRUEBA DE ENTREGA
          </legend>
          {POD_OPTIONS.map((opt) => (
            <label key={String(opt.value)} className="flex items-center gap-2 text-[11.5px] text-text-secondary">
              <input
                type="radio"
                name="orders-filter-pod"
                checked={filters.hasPod === opt.value}
                onChange={() => patch({ hasPod: opt.value })}
                className="h-[13px] w-[13px] border-border-strong text-accent"
              />
              {opt.label}
            </label>
          ))}
        </fieldset>

        {/* No preset produces minAttempts: 0, so unlike hasPod, 0 and null are
            interchangeable here — a plain two-state checkbox is enough. */}
        <label className="flex items-center gap-2 text-[11.5px] text-text-secondary">
          <input
            type="checkbox"
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
