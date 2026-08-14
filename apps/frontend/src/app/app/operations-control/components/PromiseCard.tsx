'use client';

import { StackedProgress } from '@/components/StackedProgress';
import { Skeleton } from '@/components/ui/skeleton';
import type { DayPromise } from '@/hooks/ops-control/useDayPromise';

/**
 * spec-54 phase 4 — "Promesa del día" (mock 2a, right column top).
 *
 * The mock also shows an OTIF figure. It is not rendered here: the database
 * defines OTIF as on_time / total_orders (20260309000005) and the source
 * behind this card, get_pipeline_counts, carries no on-time signal. Showing
 * delivered/total under an OTIF label would be a different number wearing the
 * name of the one the ops lead reports upward.
 */

export function PromiseCard({ promise }: { promise: DayPromise }) {
  if (promise.isLoading) {
    // Same geometry as the loaded card, so nothing jumps when it resolves.
    return (
      <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-4">
        <Skeleton className="h-3.5 w-32 rounded" />
        <Skeleton className="h-[34px] w-24 rounded" />
        <Skeleton className="h-2 w-full rounded-[5px]" />
        <Skeleton className="h-8 w-full rounded" />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-4">
      <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
        Promesa del día
      </h2>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[34px] font-bold leading-none text-text">
          {promise.total.toLocaleString('es-CL')}
        </span>
        <span className="text-[11px] leading-none text-text-muted">órdenes</span>
      </div>

      <StackedProgress
        segments={promise.segments}
        showLegend
        ariaLabel="Reparto de la promesa del día"
      />
    </section>
  );
}
