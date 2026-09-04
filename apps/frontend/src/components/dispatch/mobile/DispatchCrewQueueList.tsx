'use client';

import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

/** spec-76 2a — "DESPUÉS DE ESTA": the other loadable routes today, plain
 *  rows (no per-row action here — opening one goes through 2b, which knows
 *  the full open/blocked rules; this list is a preview, not a second entry
 *  point). */
export interface DispatchCrewQueueListProps {
  routes: RouteCard[];
}

export function DispatchCrewQueueList({ routes }: DispatchCrewQueueListProps) {
  if (routes.length === 0) return null;

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[.06em] text-text-muted">Después de esta</h2>
      <ul className="mt-2 space-y-1.5" data-testid="dispatch-crew-queue-list">
        {routes.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-[10px] border border-border bg-surface px-3 py-2.5"
          >
            <span className="font-mono text-[13px] font-semibold text-text">{r.code}</span>
            <span className="text-[12px] text-text-secondary">
              {r.comuna ?? 'Sin comuna'} · {r.packagesTotal} paquetes
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
