'use client';

import { ArrowRight } from 'lucide-react';
import type { RouteCard, ShiftScanStats } from '@/lib/dispatch/mobile/crew-board';
import type { LastDispatched } from '@/hooks/dispatch/mobile/useCrewLoadingBoard';
import { DispatchCrewTaskCard } from './DispatchCrewTaskCard';
import { DispatchCrewShiftStats } from './DispatchCrewShiftStats';
import { DispatchCrewQueueList } from './DispatchCrewQueueList';

/**
 * spec-76 2a — home de la cuadrilla. One question: what am I loading now.
 *
 * `myTask` absent renders no empty dark card (spec-76 Fase 1 test 3) — a
 * card with 0/0 progress would assert a task that does not exist. Instead
 * the crew is offered `onChooseRoute`, straight into 2b.
 */
export interface DispatchCrewHomeProps {
  isLoading: boolean;
  myTask: RouteCard | null;
  queue: RouteCard[];
  shift: ShiftScanStats;
  lastDispatched: LastDispatched | null;
  onContinueTask: (routeId: string) => void;
  onChooseRoute: () => void;
}

export function DispatchCrewHome({
  isLoading,
  myTask,
  queue,
  shift,
  lastDispatched,
  onContinueTask,
  onChooseRoute,
}: DispatchCrewHomeProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="dispatch-crew-home-skeleton">
        <div className="h-40 animate-pulse rounded-[14px] bg-surface-raised" />
        <div className="h-16 animate-pulse rounded-[10px] bg-surface-raised" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-crew-home">
      {myTask ? (
        <DispatchCrewTaskCard task={myTask} onContinue={onContinueTask} />
      ) : (
        <div className="rounded-[14px] border border-border bg-surface p-5 text-center">
          <p className="text-[13.5px] text-text">Elige una ruta para empezar a cargar.</p>
          <button
            type="button"
            onClick={onChooseRoute}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent-light text-[14px] font-semibold text-accent-light-foreground active:opacity-90"
          >
            Elegir ruta
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <DispatchCrewShiftStats scannedToday={shift.scannedToday} ratePerHour={shift.ratePerHour} />

      <DispatchCrewQueueList routes={queue} />

      {lastDispatched && (
        <p className="text-center text-[12px] text-text-muted">
          Último despacho: {lastDispatched.code} a las {lastDispatched.timeLabel}
        </p>
      )}
    </div>
  );
}
