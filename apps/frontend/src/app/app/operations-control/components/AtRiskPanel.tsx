'use client';

import { useMemo } from 'react';
import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';
import { REASON_LABELS, STAGE_LABELS } from '../lib/labels.es';
import type { StageKey } from '../lib/labels.es';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4 — "Requiere acción ahora" (mock 2a), replacing AtRiskTable.
 *
 * This is the default state of the tower: with no stage selected, this is what
 * the ops lead sees, because the screen exists to answer one question — what
 * needs me right now.
 *
 * The scanning order is deliberate. The comuna is set in the text colour at
 * semibold inside an otherwise muted address, because routing decisions are
 * made by comuna; the promise column is mono and right-aligned so a column of
 * times reads as a column.
 */

interface AtRiskPanelProps {
  orders: AtRiskOrder[];
  total: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** null = no filter. Filtering is by reason flag, per REASON_LABELS. */
  reasonFilter: string | null;
  onReasonFilterChange: (reason: string | null) => void;
  onSelectOrder?: (orderId: string) => void;
}

const GRID = 'grid grid-cols-[110px_1fr_110px_92px_88px_74px] gap-3';

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as StageKey] ?? stage;
}

export function AtRiskPanel({
  orders,
  total,
  page,
  pageCount,
  onPageChange,
  reasonFilter,
  onReasonFilterChange,
  onSelectOrder,
}: AtRiskPanelProps) {
  // Counts come from the current page's rows only, which is what the operator
  // can actually act on; labelling them as totals would overstate them.
  const reasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      if (!order.reasonFlag) continue;
      counts.set(order.reasonFlag, (counts.get(order.reasonFlag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const visible = reasonFilter
    ? orders.filter((o) => o.reasonFlag === reasonFilter)
    : orders;

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-2.5 px-4 py-3.5">
        <span className="h-[7px] w-[7px] flex-none rounded-full bg-status-error" aria-hidden="true" />
        <h2 className="font-heading text-[13.5px] font-semibold leading-none text-text">
          Requiere acción ahora
        </h2>
        <span className="rounded bg-status-error-bg px-1.5 py-1 font-mono text-[10.5px] font-semibold leading-none text-status-error-text">
          {total}
        </span>

        {reasonCounts.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {reasonCounts.map(([reason, count]) => {
              const active = reasonFilter === reason;
              return (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onReasonFilterChange(active ? null : reason)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] leading-none transition-colors',
                    active
                      ? 'border-border-strong bg-surface-raised font-semibold text-text'
                      : 'border-transparent text-text-secondary hover:bg-surface-raised',
                  )}
                >
                  {REASON_LABELS[reason] ?? reason} · {count}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div
        className={cn(
          GRID,
          'border-y border-border bg-background px-4 py-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[.09em] text-text-secondary',
        )}
      >
        <span>Orden</span>
        <span>Destino</span>
        <span>Cliente</span>
        <span>Etapa</span>
        <span>Motivo</span>
        <span className="text-right">Promesa</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">
            {reasonFilter
              ? 'Ninguna orden con este motivo en esta página.'
              : 'Nada requiere acción ahora.'}
          </p>
        ) : (
          visible.map((order) => {
            const late = order.status === 'late';
            return (
              <button
                key={order.id}
                type="button"
                data-testid="at-risk-row"
                onClick={() => onSelectOrder?.(order.id)}
                className={cn(
                  GRID,
                  'w-full items-center border-b border-l-[3px] border-border-subtle px-4 py-2.5 text-left transition-colors hover:bg-surface-raised',
                  late ? 'border-l-status-error' : 'border-l-status-warning',
                )}
              >
                <span className="truncate font-mono text-[11.5px] font-semibold text-text">
                  {order.orderNumber}
                </span>

                <span className="min-w-0 truncate text-xs text-text-secondary">
                  {order.comuna && (
                    <span className="font-semibold text-text">{order.comuna}</span>
                  )}
                  {order.comuna && order.address ? ' · ' : ''}
                  {order.address}
                </span>

                <span className="truncate text-xs text-text-secondary">{order.customer}</span>

                <span className="min-w-0">
                  <span
                    className={cn(
                      'inline-block max-w-full truncate rounded-sm px-1.5 py-[3px] text-[10.5px] font-semibold leading-none',
                      late
                        ? 'bg-status-error-bg text-status-error-text'
                        : 'bg-status-warning-bg text-status-warning-text',
                    )}
                  >
                    {stageLabel(order.stage)}
                  </span>
                </span>

                <span className="truncate text-[11px] text-text-secondary">
                  {REASON_LABELS[order.reasonFlag] ?? (order.reasonFlag || '—')}
                </span>

                <span
                  className={cn(
                    'text-right font-mono text-[11.5px] font-semibold',
                    late ? 'text-status-error-text' : 'text-status-warning-text',
                  )}
                >
                  {order.label}
                </span>
              </button>
            );
          })
        )}
      </div>

      <footer className="flex flex-none items-center gap-3 border-t border-border px-4 py-2.5">
        <span className="font-mono text-[10.5px] text-text-muted">
          {visible.length} de {total} · página {page} de {Math.max(pageCount, 1)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-medium text-text-body transition-colors hover:bg-surface-raised disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-medium text-text-body transition-colors hover:bg-surface-raised disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </footer>
    </section>
  );
}
