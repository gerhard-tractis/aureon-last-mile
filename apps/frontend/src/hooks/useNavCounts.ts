'use client';

import { useMemo } from 'react';
import { usePipelineCounts } from './usePipelineCounts';
import type { OrderStatus } from '@/lib/types/pipeline';
import { countKeyThresholds, type CountKey } from '@/components/sidebar/navigation';

/**
 * spec-54 phase 2 — queue counters for the sidebar.
 *
 * The design handoff sourced these from four separate hooks
 * (useDistributionKPIs, useDispatchKPIs, usePendingManifests,
 * useIncomingRoutes). The sidebar renders on every page in the product, so
 * that would be four permanent round-trips per navigation.
 *
 * get_pipeline_counts already returns every stage in one call and is already
 * cached (30s stale, 60s refetch), so this maps that one result instead.
 */

const STATUSES_BY_KEY: Record<CountKey, OrderStatus[]> = {
  pickup: ['ingresado'],
  reception: ['verificado'],
  distribution: ['en_bodega'],
  // Everything staged at the hub and not yet rolling counts as dispatch work.
  dispatch: ['asignado', 'en_carga', 'listo_para_despacho'],
};

export type NavCounts = Record<CountKey, number | null>;

const LOADING: NavCounts = {
  pickup: null,
  reception: null,
  distribution: null,
  dispatch: null,
};

export function useNavCounts(operatorId: string | null): NavCounts {
  const { data } = usePipelineCounts(operatorId);

  return useMemo(() => {
    // null, not 0, while unresolved: a badge that renders "0" and then jumps to
    // "318" reads as a queue that just filled up.
    if (!data) return LOADING;

    const byStatus = new Map<string, number>();
    for (const row of data) byStatus.set(row.status, row.count);

    const result = {} as NavCounts;
    for (const key of Object.keys(STATUSES_BY_KEY) as CountKey[]) {
      result[key] = STATUSES_BY_KEY[key].reduce(
        (sum, status) => sum + (byStatus.get(status) ?? 0),
        0,
      );
    }
    return result;
  }, [data]);
}

/** Neutral badge, or warning once the module's queue threshold is crossed. */
export function navCountTone(key: CountKey, count: number | null): 'neutral' | 'warning' {
  if (count === null) return 'neutral';
  return count >= countKeyThresholds[key] ? 'warning' : 'neutral';
}
