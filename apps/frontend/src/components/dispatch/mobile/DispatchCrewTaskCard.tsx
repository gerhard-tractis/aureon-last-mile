'use client';

import { ScanBarcode } from 'lucide-react';
import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

/**
 * spec-76 2a — the dark hero card: the crew's task in progress. Route code,
 * comuna, andén, `N de M` + `%`, driver (when known — routes.driver_name is
 * only ever written by the dispatch handler, so it is NULL for every route
 * this card can show; "Sin conductor" says so rather than fabricating a
 * name), and *Seguir escaneando*.
 */
export interface DispatchCrewTaskCardProps {
  task: RouteCard;
  onContinue: (routeId: string) => void;
}

export function DispatchCrewTaskCard({ task, onContinue }: DispatchCrewTaskCardProps) {
  const comunaLabel = task.comuna
    ? task.otherComunaCount > 0
      ? `${task.comuna} +${task.otherComunaCount}`
      : task.comuna
    : null;

  return (
    <div className="rounded-[14px] bg-text p-4 text-surface" data-testid="dispatch-crew-task-card">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[.06em] text-surface/70">
        <span className="font-mono font-semibold text-surface">{task.code}</span>
        {comunaLabel && <span>· {comunaLabel}</span>}
        {task.loadPositionLabel && <span>· {task.loadPositionLabel}</span>}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-heading text-[28px] font-semibold leading-none">
          {task.packagesLoaded} de {task.packagesTotal}
        </span>
        <span className="text-[15px] font-medium text-surface/80">{task.percent}%</span>
      </div>

      <p className="mt-1 text-[13px] text-surface/70">
        {task.driverName ? task.driverName : 'Sin conductor'}
      </p>

      <button
        type="button"
        onClick={() => onContinue(task.id)}
        className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-colors active:opacity-90"
      >
        <ScanBarcode className="h-5 w-5" />
        Seguir escaneando
      </button>
    </div>
  );
}
