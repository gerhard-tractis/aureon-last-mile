'use client';

import { Check, TriangleAlert } from 'lucide-react';
import type { CompletedManifest } from '@/hooks/pickup/useManifests';

/**
 * spec-54 phase 4.4 — "Cierres de hoy" (mock 1l/5a, right column bottom).
 *
 * spec-83 fase 1: get_completed_manifests now returns missing_count, a COUNT
 * over public.discrepancies (spec-85, kind='missing', operation_type=
 * 'pickup') for this manifest. A row with missing_count > 0 renders in the
 * warning palette with "N faltantes de M"; a clean close (missing_count = 0)
 * keeps the original success palette and "M paquetes" line.
 */

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function TodayClosuresPanel({ rows }: { rows: CompletedManifest[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <header className="flex flex-none items-baseline gap-2 border-b border-border px-4 py-3.5">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Cierres de hoy
        </h2>
        <span className="ml-auto font-mono text-[11px] font-medium leading-none text-text-secondary">
          {rows.length} {rows.length === 1 ? 'completado' : 'completados'}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">
            Todavía no se cierra ninguna carga hoy.
          </p>
        ) : (
          rows.map((row) => {
            const hasMissing = row.missing_count > 0;

            return (
              <div
                key={row.id}
                data-testid="closure-row"
                className={`flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 last:border-b-0 ${
                  hasMissing ? 'bg-status-warning-bg' : ''
                }`}
              >
                <span
                  className={`grid h-6 w-6 flex-none place-items-center rounded-[7px] border ${
                    hasMissing
                      ? 'border-status-warning-border bg-status-warning-bg'
                      : 'border-status-success-border bg-status-success-bg'
                  }`}
                >
                  {hasMissing ? (
                    <TriangleAlert className="h-3 w-3 text-status-warning" strokeWidth={3} />
                  ) : (
                    <Check className="h-3 w-3 text-status-success" strokeWidth={3} />
                  )}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate font-mono text-[11.5px] font-semibold leading-none text-text">
                    {row.external_load_id}
                  </span>
                  {hasMissing ? (
                    <span className="truncate text-[10.5px] font-semibold leading-none text-status-warning-text">
                      {row.missing_count} {row.missing_count === 1 ? 'faltante' : 'faltantes'} de{' '}
                      {row.total_packages ?? 0}
                    </span>
                  ) : (
                    <span className="truncate text-[10.5px] leading-none text-text-muted">
                      {row.retailer_name ?? 'Sin cliente'} · {row.total_packages ?? 0} paquetes
                    </span>
                  )}
                </div>

                <span className="flex-none font-mono text-[10.5px] font-medium text-text-muted">
                  {timeLabel(row.completed_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
