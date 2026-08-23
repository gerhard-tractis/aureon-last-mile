'use client';

/**
 * ActiveFilterChips — the active-filters bar above `OrdersDataTable` on
 * `/app/orders` (spec-65, mock `3a`). One chip per active FILTER CATEGORY
 * (all statuses collapse into a single "estado: ..." chip, not one per
 * value), each removable, plus "Limpiar" for everything at once.
 *
 * Per spec-65 Decision 2, "Guardar vista" never persists anything — it
 * copies the current URL. That URL is the page's to own (only it knows the
 * route), so the copy action arrives here as a callback prop.
 */

import { X } from 'lucide-react';
import type { OrdersListFilters } from '@/hooks/useOrdersList';
import { displayForOrderStatus } from '@/lib/orders/order-status-display';

interface ActiveFilterChipsProps {
  filters: OrdersListFilters;
  resultCount: number;
  onFiltersChange: (filters: OrdersListFilters) => void;
  onClearAll: () => void;
  onCopyShareableUrl: () => void;
}

interface Chip {
  key: string;
  label: string;
  clear: Partial<OrdersListFilters>;
}

function buildChips(filters: OrdersListFilters): Chip[] {
  const chips: Chip[] = [];

  if (filters.statuses && filters.statuses.length > 0) {
    chips.push({
      key: 'estado',
      label: `estado: ${filters.statuses.map((s) => displayForOrderStatus(s).label.toLowerCase()).join(', ')}`,
      clear: { statuses: null },
    });
  }
  if (filters.sla && filters.sla.length > 0) {
    chips.push({ key: 'sla', label: `sla: ${filters.sla.join(', ')}`, clear: { sla: null } });
  }
  if (filters.routeIds && filters.routeIds.length > 0) {
    chips.push({ key: 'ruta', label: `ruta: ${filters.routeIds.join(', ')}`, clear: { routeIds: null } });
  }
  if (filters.driver) {
    chips.push({ key: 'courier', label: `courier: ${filters.driver}`, clear: { driver: null } });
  }
  if (filters.client) {
    chips.push({ key: 'cliente', label: `cliente: ${filters.client}`, clear: { client: null } });
  }
  if (filters.comunas && filters.comunas.length > 0) {
    chips.push({ key: 'zona', label: `zona: ${filters.comunas.join(', ')}`, clear: { comunas: null } });
  }
  if (filters.dateFrom || filters.dateTo) {
    chips.push({
      key: 'fecha',
      label: `fecha: ${filters.dateFrom ?? '…'} – ${filters.dateTo ?? '…'}`,
      clear: { dateFrom: null, dateTo: null },
    });
  }
  // hasPod: false / minAttempts: 0 are meaningful filters, not "unset" — the
  // strict null checks below (not `if (filters.hasPod)`) are load-bearing.
  if (filters.hasPod !== null && filters.hasPod !== undefined) {
    chips.push({
      key: 'pod',
      label: filters.hasPod ? 'con prueba de entrega' : 'sin prueba de entrega',
      clear: { hasPod: null },
    });
  }
  if (filters.minAttempts !== null && filters.minAttempts !== undefined) {
    chips.push({
      key: 'intentos',
      label: `${filters.minAttempts}+ intentos`,
      clear: { minAttempts: null },
    });
  }
  if (filters.search) {
    chips.push({ key: 'busqueda', label: `busca: ${filters.search}`, clear: { search: null } });
  }

  return chips;
}

export function ActiveFilterChips({
  filters,
  resultCount,
  onFiltersChange,
  onClearAll,
  onCopyShareableUrl,
}: ActiveFilterChipsProps) {
  const chips = buildChips(filters);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle bg-surface px-5.5 py-2.5">
      {chips.length > 0 && (
        <span className="text-[10.5px] font-medium text-text-secondary">Filtros activos:</span>
      )}
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="flex items-center gap-1.5 rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] font-medium text-text"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Quitar ${chip.key}`}
            onClick={() => onFiltersChange({ ...filters, ...chip.clear })}
            className="text-text-muted hover:text-text"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[10.5px] font-medium text-accent"
        >
          Limpiar
        </button>
      )}
      <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-text-muted">
        {resultCount} resultados ·{' '}
        <button type="button" onClick={onCopyShareableUrl} className="underline">
          URL compartible
        </button>
      </span>
    </div>
  );
}
