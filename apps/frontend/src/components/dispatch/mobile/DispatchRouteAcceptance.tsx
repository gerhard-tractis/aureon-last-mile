'use client';

import { CheckCircle2 } from 'lucide-react';
import { useDispatchNextLoad } from '@/hooks/dispatch/mobile/useDispatchNextLoad';
import { buildActaFigures, dockLeftLine, nextLoadLine } from '@/lib/dispatch/mobile/dispatch-acta';

/**
 * spec-77 Fase 4 — `2l`, "Ruta despachada". Shown by `DispatchRouteScanSession`
 * once the dispatch call itself returns `ok: true` (item 18 — this screen
 * never runs its own state assertion; it only renders what the endpoint,
 * already covered by spec-79's own tests, actually returned). Decision 7:
 * the acta reincorporates the crew into the flow, not a dead end — the
 * "next load" row, when one exists, is the primary next step.
 */
export interface DispatchRouteAcceptanceProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  externalRouteId: string;
  stopsCount: number;
  packagesDispatched: number;
  /** Item 16 — from the SEAL/force outcome (`forced.released_count` +
   *  `forced.split_count`), threaded up through `DispatchRouteScanSession`
   *  — never re-derived here from package state. */
  packagesLeftAtDock: number;
  splitOrdersCount: number;
  onBack: () => void;
  onOpenNextLoad: (routeId: string) => void;
}

export function DispatchRouteAcceptance({
  routeId,
  operatorId,
  routeCode,
  externalRouteId,
  stopsCount,
  packagesDispatched,
  packagesLeftAtDock,
  splitOrdersCount,
  onBack,
  onOpenNextLoad,
}: DispatchRouteAcceptanceProps) {
  const figures = buildActaFigures({ stopsCount, packagesDispatched, packagesLeftAtDock, splitOrdersCount });
  const nextLoad = useDispatchNextLoad(operatorId, routeId);
  const nextLoadText = nextLoadLine(nextLoad);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4" data-testid="dispatch-route-acceptance">
      <div className="flex flex-col items-center gap-2 py-2">
        <div
          className="grid h-[74px] w-[74px] place-items-center rounded-full bg-status-success-bg text-status-success"
          aria-hidden="true"
        >
          <CheckCircle2 className="h-10 w-10" strokeWidth={2} />
        </div>
        <h1 className="font-heading text-[23px] font-semibold leading-tight text-text">Ruta despachada</h1>
        <p className="text-sm text-text-secondary">
          {routeCode} · DispatchTrack {externalRouteId}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        {figures.map((f) => (
          <div
            key={f.testId}
            data-testid={f.testId}
            className="flex h-[52px] items-center justify-between border-b border-border px-4 last:border-b-0"
          >
            <span className="text-sm text-text-secondary">{f.label}</span>
            <span className="font-heading text-[18px] font-semibold text-text">{f.value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <p className="mb-1 text-xs font-semibold tracking-[.05em] text-text-secondary">EN LA NAVE</p>
        <p className="text-sm text-text">{dockLeftLine(packagesLeftAtDock, splitOrdersCount)}</p>
      </div>

      {nextLoadText && nextLoad && (
        <button
          type="button"
          data-testid="acta-siguiente-carga"
          onClick={() => onOpenNextLoad(nextLoad.id)}
          className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left active:bg-surface-raised"
        >
          <div>
            <p className="text-xs font-semibold tracking-[.05em] text-text-secondary">SIGUIENTE CARGA</p>
            <p className="text-sm font-medium text-text">{nextLoadText}</p>
          </div>
        </button>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-auto min-h-[56px] w-full rounded-[14px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
      >
        Volver a mis rutas
      </button>
    </div>
  );
}
