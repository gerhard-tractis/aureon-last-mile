'use client';

/**
 * OrdersDataTable — the 41px-row order list on `/app/orders` (spec-65, mock
 * `3a`). Presentational only: `sla_status`/`minutes_remaining` arrive
 * already computed by `order_sla_status` (Task 1/2) and are only FORMATTED
 * here, never re-derived — re-deriving the verdict client-side is exactly
 * what `get_orders_list` exists to avoid.
 *
 * The empty state matters more than usual: zero of 192 QA orders carry a
 * `delivery_window_end`, so `sla_status` is `'none'` for all of them and
 * the default "SLA en riesgo" view legitimately renders zero rows. This
 * must read as "nothing matches this view", not an error.
 *
 * Row click vs. checkbox: the checkbox is a native `<input>` inside its own
 * cell (a real, independent tab stop), and opening the row is a `<button>`
 * around the order number (a second, separate tab stop) — never a
 * `<tr onClick>` that would swallow the checkbox's own click/keyboard
 * handling.
 */

import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { PackageSearch } from 'lucide-react';
import type { OrdersListRow } from '@/hooks/useOrdersList';
import { displayForOrderStatus } from '@/lib/orders/order-status-display';

interface OrdersDataTableProps {
  rows: OrdersListRow[];
  isLoading: boolean;
  selectedIds: string[];
  onRowClick: (id: string) => void;
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleSelectAll: (selected: boolean) => void;
}

const SLA_TEXT_CLASS: Record<string, string> = {
  late: 'text-status-error-text',
  at_risk: 'text-status-warning-text',
  ok: 'text-status-success-text',
  none: 'text-text-muted',
};

const SLA_BORDER_CLASS: Record<string, string> = {
  late: 'border-l-status-error',
  at_risk: 'border-l-status-warning',
  ok: 'border-l-status-success',
  none: 'border-l-border',
};

/** Formats from the already-computed verdict — signed, hours omitted under 60 minutes. */
function formatSlaCell(slaStatus: string, minutesRemaining: number | null): string {
  if (slaStatus === 'none' || minutesRemaining === null) return '—';
  const sign = minutesRemaining < 0 ? '−' : '+';
  const abs = Math.abs(minutesRemaining);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h > 0 ? `${sign}${h}h ${String(m).padStart(2, '0')}m` : `${sign}${m}m`;
}

function formatLastEvent(row: OrdersListRow): string {
  if (!row.last_event_at) return row.last_event_label ?? '—';
  const time = new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago',
  }).format(new Date(row.last_event_at));
  return row.last_event_label ? `${time} ${row.last_event_label}` : time;
}

const HEADERS = ['PEDIDO', 'CLIENTE', 'ESTADO', 'PQT', 'RUTA · CONDUCTOR', 'SLA', 'ÚLTIMO EVENTO'];

function TableSkeleton() {
  return (
    <div data-testid="orders-table-skeleton" className="flex flex-col">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="mx-5.5 my-1 h-[33px] rounded-sm" />
      ))}
    </div>
  );
}

export function OrdersDataTable({
  rows,
  isLoading,
  selectedIds,
  onRowClick,
  onToggleSelect,
  onToggleSelectAll,
}: OrdersDataTableProps) {
  const selected = new Set(selectedIds);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  if (isLoading) return <TableSkeleton />;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Sin pedidos en esta vista"
        description="Ningún pedido coincide con los filtros aplicados. Prueba otra vista o ajusta los filtros del riel."
      />
    );
  }

  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="h-[34px] bg-surface-raised">
          <th className="w-[30px] px-5.5">
            <input
              type="checkbox"
              aria-label="Seleccionar todo"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && someSelected;
              }}
              onChange={(e) => onToggleSelectAll(e.target.checked)}
            />
          </th>
          {HEADERS.map((h) => (
            <th
              key={h}
              className="px-1.5 text-left font-mono text-[9.5px] font-semibold tracking-wider text-text-muted"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = displayForOrderStatus(row.leading_status);
          const isDelivered = row.leading_status === 'entregado';
          const routeDriver =
            row.route_label && row.driver_name
              ? `${row.route_label} · ${row.driver_name}`
              : row.route_label ?? 'sin asignar';

          return (
            <tr
              key={row.id}
              className={cn(
                'h-[41px] border-b border-border-subtle border-l-[3px]',
                SLA_BORDER_CLASS[row.sla_status] ?? SLA_BORDER_CLASS.none,
              )}
            >
              <td className="px-5.5">
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${row.order_number}`}
                  checked={selected.has(row.id)}
                  onChange={(e) => onToggleSelect(row.id, e.target.checked)}
                />
              </td>
              <td className="px-1.5">
                <button
                  type="button"
                  aria-label={`Abrir pedido ${row.order_number}`}
                  onClick={() => onRowClick(row.id)}
                  className="font-mono font-semibold text-text hover:underline"
                >
                  {row.order_number}
                </button>
              </td>
              <td className="truncate px-1.5 text-text-body">{row.customer_name}</td>
              <td className="px-1.5">
                <StatusBadge status={status.label} variant={status.variant} size="sm" />
              </td>
              <td className="px-1.5 text-right font-mono text-text-secondary">{row.package_count}</td>
              <td className="truncate px-1.5 text-text-secondary">{routeDriver}</td>
              <td className={cn('px-1.5 font-mono font-semibold', SLA_TEXT_CLASS[row.sla_status] ?? SLA_TEXT_CLASS.none)}>
                {formatSlaCell(row.sla_status, row.minutes_remaining)}
              </td>
              <td className="flex items-center gap-1.5 truncate px-1.5 text-text-muted">
                {formatLastEvent(row)}
                {isDelivered && (
                  <StatusBadge
                    status={row.has_pod ? 'POD' : 'SIN POD'}
                    variant={row.has_pod ? 'success' : 'warning'}
                    size="sm"
                  />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
