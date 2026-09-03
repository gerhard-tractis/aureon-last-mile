'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { AlertTriangle, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PreRouteAnden, PreRouteSnapshot } from '@/lib/types';
import {
  collectAndenOptions,
  collectComunaOptions,
  collectClienteOptions,
  parsePreRouteFilterState,
  serializePreRouteFilterState,
  type PreRouteFilterState,
} from '@/lib/dispatch/pre-route-filters';
import { MultiSelectFilter } from './filters/MultiSelectFilter';

/**
 * spec-75 task 2b — replaces the four fixed time-band tabs (Todas/Mañana/
 * Tarde/Noche) with: a free ventana range (the RPC's own p_window_start/
 * p_window_end), comuna/andén/cliente multi-selects, a "sólo con
 * problemas" toggle, and búsqueda over order number + address. The bands
 * grouped orders by fixed slot while delivery windows are arbitrary
 * per-order times — they hid orders rather than narrowing them.
 *
 * All filter state lives in the URL (`useSearchParams`), same as `date`
 * already did, so a filtered view is shareable and survives reload. The
 * date and window params keep their own keys (`date`, `window_start`,
 * `window_end`) because they drive the RPC call itself
 * (`usePreRouteSnapshot`); comuna/andén/cliente/problems/búsqueda narrow
 * the returned snapshot client-side (`applyPreRouteFilters` in
 * `lib/dispatch/pre-route-filters.ts`) and are read/written as one group
 * through `parsePreRouteFilterState`/`serializePreRouteFilterState` so this
 * component never has to know their individual URL key names.
 */

const FILTER_KEYS = ['comunas', 'andenes', 'clientes', 'problems', 'q'] as const;

type Props = {
  totals?: PreRouteSnapshot['totals'];
  andenes: PreRouteAnden[];
};

export function PreRouteFilters({ totals, andenes }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const today = new Date().toISOString().slice(0, 10);
  const date = params.get('date') ?? today;
  const windowStart = params.get('window_start') ?? '';
  const windowEnd = params.get('window_end') ?? '';
  const filters = parsePreRouteFilterState(params);

  const comunaOptions = useMemo(() => collectComunaOptions(andenes), [andenes]);
  const andenOptions = useMemo(() => collectAndenOptions(andenes), [andenes]);
  const clienteOptions = useMemo(
    () => collectClienteOptions(andenes).map((name) => ({ id: name, name })),
    [andenes],
  );

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  function updateFilters(patch: Partial<PreRouteFilterState>) {
    const nextState: PreRouteFilterState = { ...filters, ...patch };
    const next = new URLSearchParams(params.toString());
    for (const key of FILTER_KEYS) next.delete(key);
    serializePreRouteFilterState(nextState).forEach((value, key) => next.set(key, value));
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
      <input
        type="date"
        value={date}
        onChange={(e) => setParam('date', e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1">
        <label htmlFor="pre-route-window-start" className="text-[11px] text-text-muted">
          Desde
        </label>
        <input
          id="pre-route-window-start"
          type="time"
          value={windowStart}
          onChange={(e) => setParam('window_start', e.target.value)}
          className="w-[88px] bg-transparent text-sm focus:outline-none"
        />
        <label htmlFor="pre-route-window-end" className="text-[11px] text-text-muted">
          Hasta
        </label>
        <input
          id="pre-route-window-end"
          type="time"
          value={windowEnd}
          onChange={(e) => setParam('window_end', e.target.value)}
          className="w-[88px] bg-transparent text-sm focus:outline-none"
        />
      </div>

      <MultiSelectFilter
        label="Comuna"
        options={comunaOptions}
        selected={filters.comunaIds}
        onChange={(comunaIds) => updateFilters({ comunaIds })}
      />
      <MultiSelectFilter
        label="Andén"
        options={andenOptions}
        selected={filters.andenIds}
        onChange={(andenIds) => updateFilters({ andenIds })}
      />
      <MultiSelectFilter
        label="Cliente"
        options={clienteOptions}
        selected={filters.clientes}
        onChange={(clientes) => updateFilters({ clientes })}
      />

      <button
        type="button"
        aria-pressed={filters.onlyProblems}
        onClick={() => updateFilters({ onlyProblems: !filters.onlyProblems })}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
          filters.onlyProblems
            ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
            : 'border-input bg-background text-foreground hover:bg-muted',
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Sólo con problemas
      </button>

      <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        <input
          type="text"
          value={filters.search}
          placeholder="Buscar por orden o dirección..."
          onChange={(e) => updateFilters({ search: e.target.value })}
          className="w-48 bg-transparent text-sm focus:outline-none"
        />
      </div>

      {totals && (
        <span className="ml-auto text-sm text-muted-foreground">
          {totals.order_count} órdenes · {totals.package_count} bultos · {totals.anden_count} andenes
        </span>
      )}
    </div>
  );
}
