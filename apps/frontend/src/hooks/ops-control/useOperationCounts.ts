'use client';

import { useMemo } from 'react';
import { useOpsControlSnapshot } from './useOpsControlSnapshot';

/**
 * Tower header counts — distinct from "Promesa del día" (useDayPromise) on
 * purpose. The promise card asks "how is TODAY's delivery promise going?"
 * (get_pipeline_counts, delivery_date = today). The header asks "how much work
 * is in the operation right now?", which is date-independent:
 *
 *   - inOperation: orders already picked up (past 'ingresado') and not yet
 *     delivered. Sourced from the ops snapshot, which already excludes
 *     entregado / cancelado / return states.
 *   - late: the subset whose effective delivery date (rescheduled wins over
 *     original) is before today — including orders overdue since ANY earlier
 *     day, which the promise counters structurally cannot see.
 */

export interface OperationCounts {
  inOperation: number;
  late: number;
  isLoading: boolean;
}

/** Local calendar date as YYYY-MM-DD — toISOString would shift near midnight. */
function localDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function useOperationCounts(
  operatorId: string | null,
  now: Date = new Date()
): OperationCounts {
  const { snapshot, isLoading } = useOpsControlSnapshot(operatorId);
  const today = localDateString(now);

  return useMemo(() => {
    if (!snapshot) return { inOperation: 0, late: 0, isLoading };

    let inOperation = 0;
    let late = 0;
    for (const order of snapshot.orders) {
      if (order['status'] === 'ingresado') continue; // not picked up yet
      inOperation += 1;
      const effective =
        (order['effective_delivery_date'] as string | null | undefined) ??
        (order['delivery_date'] as string | null | undefined);
      if (effective && effective < today) late += 1;
    }
    return { inOperation, late, isLoading: false };
  }, [snapshot, isLoading, today]);
}
