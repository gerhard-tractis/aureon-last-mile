'use client';

import type { ActiveSorter } from '@/hooks/distribution/useDistributionOverview';

/**
 * spec-54 mock 3d — "Operarios activos".
 *
 * Anyone who scanned in the last 30 minutes, with their andén and their count.
 * The floor lead uses this to answer "is anyone on A5", which is why the andén
 * and the time of the last scan matter more than the total.
 */

function initials(name: string | null): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function ActiveSortersPanel({
  sorters,
  isLoading = false,
}: {
  sorters: ActiveSorter[];
  isLoading?: boolean;
}) {
  return (
    <section className="flex flex-none flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex flex-none items-center gap-2 border-b border-border px-3.5 py-3">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Operarios activos
        </h2>
        <span className="ml-auto font-mono text-[10.5px] font-semibold leading-none text-text-secondary">
          {sorters.length} escaneando
        </span>
      </header>

      <div className="max-h-72 overflow-y-auto">
        {isLoading ? (
          <p className="px-3.5 py-8 text-center text-[12.5px] text-text-secondary">Cargando…</p>
        ) : sorters.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-[12.5px] leading-normal text-text-secondary">
            Nadie está escaneando en este momento.
          </p>
        ) : (
          sorters.map((s) => (
            <div
              key={s.user_id}
              data-testid="active-sorter"
              className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-2.5 last:border-b-0"
            >
              <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-surface-raised font-mono text-[9.5px] font-semibold text-accent">
                {initials(s.name)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="truncate text-[11.5px] font-semibold leading-none text-text">
                  {s.name ?? 'Sin nombre'}
                  {s.zone_code ? ` · andén ${s.zone_code}` : ''}
                </span>
                <span className="truncate text-[10.5px] leading-none text-text-muted">
                  {s.scans} {s.scans === 1 ? 'escaneo' : 'escaneos'} · último{' '}
                  {timeLabel(s.last_scan_at)}
                </span>
              </div>
              <span
                className="h-1.5 w-1.5 flex-none rounded-full bg-status-success"
                aria-hidden="true"
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
