'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  ARRIVAL_STATE_LABEL,
  YARD_WAIT_WARNING_MINUTES,
  type ArrivalRow,
  type ArrivalState,
} from '@/app/app/reception/arrivals';

/**
 * spec-54 phase 4.6 — "Llegadas de hoy" (mock 3c, left).
 *
 * One list instead of three tabs. A truck sitting in the yard uncounted is the
 * only thing on this screen that costs money by the minute, so those rows are
 * tinted and carry their wait; everything else is context.
 */

const FILTERS: { key: 'all' | ArrivalState; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'yard', label: 'En patio' },
  { key: 'transit', label: 'En tránsito' },
  { key: 'closed', label: 'Cerradas' },
];

const GRID = 'grid grid-cols-[92px_1fr_112px_84px_120px] items-center gap-3';

interface ArrivalsPanelProps {
  rows: ArrivalRow[];
  filter: 'all' | ArrivalState;
  onFilterChange: (filter: 'all' | ArrivalState) => void;
  isLoading?: boolean;
}

export function ArrivalsPanel({
  rows,
  filter,
  onFilterChange,
  isLoading = false,
}: ArrivalsPanelProps) {
  const counts = {
    all: rows.length,
    yard: rows.filter((r) => r.state === 'yard').length,
    transit: rows.filter((r) => r.state === 'transit').length,
    closed: rows.filter((r) => r.state === 'closed').length,
  };
  const visible = filter === 'all' ? rows : rows.filter((r) => r.state === filter);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex flex-none flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <h2 className="font-heading text-[13px] font-semibold leading-none text-text">
          Llegadas de hoy
        </h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] leading-none transition-colors',
                filter === f.key
                  ? 'border-border bg-surface-raised font-semibold text-text'
                  : 'border-border text-text-secondary hover:bg-surface-raised',
              )}
            >
              {f.label} {counts[f.key]}
            </button>
          ))}
        </div>
      </header>

      <div
        className={cn(
          GRID,
          'h-[31px] flex-none border-b border-border bg-surface-raised px-4 font-mono text-[9.5px] font-semibold uppercase tracking-[.09em] text-text-muted',
        )}
      >
        <span>Ruta</span>
        <span>Conductor · manifiestos</span>
        <span>Estado</span>
        <span className="text-right">Paq.</span>
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">
            {filter === 'yard'
              ? 'Ninguna ruta esperando en patio.'
              : 'Ninguna llegada con este filtro.'}
          </p>
        ) : (
          visible.map((row) => {
            const waiting = row.waitingMinutes ?? 0;
            const overdue = row.state === 'yard' && waiting >= YARD_WAIT_WARNING_MINUTES;

            return (
              <div
                key={row.id}
                data-testid="arrival-row"
                className={cn(
                  GRID,
                  'h-14 border-b border-l-[3px] border-border-subtle px-4',
                  row.state === 'yard'
                    ? overdue
                      ? 'border-l-status-warning bg-status-warning-bg'
                      : 'border-l-status-warning'
                    : 'border-l-transparent',
                )}
              >
                <span className="truncate font-mono text-[12.5px] font-semibold text-text">
                  {row.code}
                </span>

                <div className="flex min-w-0 flex-col gap-1 pr-3">
                  <span className="truncate text-xs text-text-body">
                    {row.driverName ?? 'Sin conductor'} · {row.manifestCount}{' '}
                    {row.manifestCount === 1 ? 'manifiesto' : 'manifiestos'}
                  </span>
                  {row.state === 'yard' && row.arrivedAtLabel && (
                    <span
                      className={cn(
                        'truncate text-[10.5px] leading-none',
                        overdue ? 'text-status-warning-text' : 'text-text-muted',
                      )}
                    >
                      en patio desde {row.arrivedAtLabel} · esperando {waiting} min
                    </span>
                  )}
                </div>

                <span
                  className={cn(
                    'justify-self-start rounded border bg-surface px-1.5 py-1 font-mono text-[9.5px] font-semibold leading-none',
                    row.state === 'yard'
                      ? 'border-status-warning-border text-status-warning-text'
                      : row.state === 'closed'
                        ? 'border-status-success-border text-status-success-text'
                        : 'border-border text-text-secondary',
                  )}
                >
                  {ARRIVAL_STATE_LABEL[row.state]}
                </span>

                <span className="text-right font-mono text-xs text-text">
                  {row.expectedPackages}
                </span>

                {row.state === 'closed' ? (
                  <span className="justify-self-end text-[11px] text-text-muted">Cerrada</span>
                ) : (
                  <Link
                    href={`/app/reception/route/${row.id}`}
                    className="justify-self-end rounded-[7px] bg-accent-light px-3 py-2 text-[11.5px] font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
                  >
                    {row.state === 'yard' ? 'Iniciar conteo' : 'Ver ruta'}
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
