'use client';

import { cn } from '@/lib/utils';
import type { OpenDiscrepancy } from '@/hooks/reception/useOpenDiscrepancies';

/**
 * spec-54 phase 4.6 — "Pendiente de resolución" (mock 3c, right).
 *
 * Closed receptions whose count never matched. These are the ones that stop
 * being anybody's problem the moment the truck leaves, which is exactly why
 * they get a panel of their own on the screen the receptionist starts from.
 */
export function PendingResolutionPanel({
  discrepancies,
  isLoading = false,
}: {
  discrepancies: OpenDiscrepancy[];
  isLoading?: boolean;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border bg-surface',
        discrepancies.length > 0 ? 'border-status-error-border' : 'border-border',
      )}
    >
      <header className="flex flex-none items-center gap-2 border-b border-border px-3.5 py-3">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Pendiente de resolución
        </h2>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-1 font-mono text-[10.5px] font-semibold leading-none',
            discrepancies.length > 0
              ? 'bg-status-error-bg text-status-error-text'
              : 'bg-surface-raised text-text-muted',
          )}
        >
          {discrepancies.length}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-3.5 py-8 text-center text-[12.5px] text-text-secondary">Cargando…</p>
        ) : discrepancies.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-[12.5px] leading-normal text-text-secondary">
            Ninguna recepción cerrada con diferencias.
          </p>
        ) : (
          discrepancies.map((d) => {
            // Positive delta = short. Negative = more arrived than the
            // manifest declared, which is a different problem and reads
            // differently.
            const short = d.delta > 0;
            return (
              <div
                key={d.id}
                data-testid="discrepancy-row"
                className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-2.5 last:border-b-0"
              >
                <span
                  className={cn(
                    'grid h-7 w-7 flex-none place-items-center rounded-lg border font-mono text-[11px] font-bold',
                    short
                      ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
                      : 'border-status-error-border bg-status-error-bg text-status-error-text',
                  )}
                >
                  {short ? d.delta : `+${Math.abs(d.delta)}`}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate text-[11.5px] font-semibold leading-none text-text">
                    {short ? 'Faltantes' : 'Sobrantes'} · {d.routeCode}
                  </span>
                  <span className="truncate text-[10.5px] leading-none text-text-muted">
                    {d.received} de {d.expected} paquetes contados
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
