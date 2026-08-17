'use client';

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';
import { countKeyThresholds, type CountKey } from '@/components/sidebar/navigation';

/**
 * spec-54 — queue counters for the sidebar.
 *
 * Reads get_nav_counts (20260817000001), which counts the same unit each
 * module's own screen leads with. It used to map get_pipeline_counts, which
 * counts ORDERS by orders.status — the wrong unit, and one that under-reports:
 * recalculate_order_status collapses the package-only states back to
 * `en_bodega`, so a package already sorted onto an andén still counted as
 * reception work. The nav read Distribución 0 while the Distribución screen
 * showed 25 packages waiting to be sorted.
 *
 * Still one round trip, and still cached — the sidebar renders on every page,
 * so this hook has to stay cheap.
 */

export type NavCounts = Record<CountKey, number | null>;

const LOADING: NavCounts = {
  pickup: null,
  reception: null,
  distribution: null,
  dispatch: null,
};

interface NavCountsRow {
  pickup: number;
  reception: number;
  distribution: number;
  dispatch: number;
}

export function useNavCounts(operatorId: string | null): NavCounts {
  const { data } = useQuery<NavCountsRow | null>({
    queryKey: ['nav-counts', operatorId],
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await callRpc<NavCountsRow[]>(
        createSPAClient(),
        'get_nav_counts',
        { p_operator_id: operatorId! },
      );
      if (error) throw error;
      // RETURNS TABLE gives a one-row set, not a scalar.
      return data?.[0] ?? null;
    },
  });

  // null, not 0, while unresolved: a badge that renders "0" and then jumps to
  // "318" reads as a queue that just filled up.
  if (!data) return LOADING;

  return {
    pickup: data.pickup,
    reception: data.reception,
    distribution: data.distribution,
    dispatch: data.dispatch,
  };
}

/** Neutral badge, or warning once the module's queue threshold is crossed. */
export function navCountTone(key: CountKey, count: number | null): 'neutral' | 'warning' {
  if (count === null) return 'neutral';
  return count >= countKeyThresholds[key] ? 'warning' : 'neutral';
}
