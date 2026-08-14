'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { DayPromise } from '@/hooks/ops-control/useDayPromise';

/**
 * spec-54 phase 4 — the tower's title row (mock 2a).
 *
 * The mock also carries a Hoy / Mañana / Semana segmented control. It is not
 * built here: useOpsControlSnapshot takes no date argument, so the control
 * would render three options that all show today. A dead segmented control on
 * the screen the ops lead trusts is worse than not offering the choice yet —
 * it comes back when the snapshot RPC takes a date.
 */

function todayLabel(now: Date): string {
  const text = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface TowerHeaderProps {
  promise: DayPromise;
  now?: Date;
}

export function TowerHeader({ promise, now = new Date() }: TowerHeaderProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="font-heading text-[26px] font-semibold leading-[1.1] tracking-[-.02em] text-text">
          Torre de control
        </h1>
        <p className="text-[12.5px] leading-none text-text-secondary">
          {todayLabel(now)}
          {!promise.isLoading && (
            <>
              {' · '}
              <span className="font-mono font-semibold text-text">
                {promise.total.toLocaleString('es-CL')}
              </span>
              {' órdenes en operación · '}
              <span className="font-mono font-semibold text-status-error-text">
                {promise.late.toLocaleString('es-CL')}
              </span>
              {' atrasadas'}
            </>
          )}
        </p>
      </div>

      <Link
        href="/app/dispatch"
        className="ml-auto inline-flex h-[34px] flex-none items-center gap-1.5 rounded-lg bg-accent-light px-3.5 text-xs font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" />
        Nueva ruta
      </Link>
    </div>
  );
}
