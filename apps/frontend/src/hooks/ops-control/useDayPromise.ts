'use client';

import { useMemo } from 'react';
import { usePipelineCounts } from '../usePipelineCounts';
import type { ProgressSegment } from '@/components/StackedProgress';

/**
 * spec-54 phase 4 — "Promesa del día" on the tower (mock 2a).
 *
 * Sourced from get_pipeline_counts rather than the ops-control snapshot,
 * because the snapshot deliberately excludes `entregado` (see
 * 20260513000004) and this card is mostly about what has already landed.
 *
 * NOT reported here: OTIF. The mock shows it, but the database defines OTIF as
 * on_time / total_orders (20260309000005), and get_pipeline_counts carries no
 * on-time signal. Delivered/total is a different number, and labelling it OTIF
 * on the screen the ops lead trusts would be worse than leaving it out. Wiring
 * the dashboard rollup in is a follow-up.
 */

export interface DayPromise {
  total: number;
  delivered: number;
  inFlight: number;
  atRisk: number;
  late: number;
  segments: ProgressSegment[];
  isLoading: boolean;
}

const EMPTY: DayPromise = {
  total: 0,
  delivered: 0,
  inFlight: 0,
  atRisk: 0,
  late: 0,
  segments: [],
  isLoading: true,
};

export function useDayPromise(operatorId: string | null): DayPromise {
  const { data } = usePipelineCounts(operatorId);

  return useMemo(() => {
    if (!data) return EMPTY;

    let total = 0;
    let delivered = 0;
    let atRisk = 0;
    let late = 0;

    for (const row of data) {
      total += row.count;

      if (row.status === 'entregado') {
        delivered += row.count;
        // A delivered order can still carry a late_count ("delivered, but
        // late"). It is no longer *at risk* of missing the promise — it
        // already resolved — so counting it again would double-count it and
        // push the segments past the total.
        continue;
      }

      late += row.late_count;
      atRisk += row.urgent_count + row.alert_count;
    }

    // Everything still moving and not flagged. Clamped: if the RPC ever
    // reports more flagged orders than rows, a negative segment renders as a
    // broken bar rather than an obvious data problem.
    const inFlight = Math.max(0, total - delivered - atRisk - late);

    const segments: ProgressSegment[] = [
      { key: 'delivered', label: 'Entregadas', value: delivered, tone: 'success' },
      { key: 'in_flight', label: 'En ruta', value: inFlight, tone: 'accent' },
      { key: 'at_risk', label: 'En riesgo', value: atRisk, tone: 'warning' },
      { key: 'late', label: 'Atrasadas', value: late, tone: 'error' },
    ];

    return { total, delivered, inFlight, atRisk, late, segments, isLoading: false };
  }, [data]);
}
