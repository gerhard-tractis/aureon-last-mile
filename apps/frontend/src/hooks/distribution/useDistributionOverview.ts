import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';

/**
 * spec-54 mock 3d — the numbers on the Distribución landing that had no source.
 *
 * Open lotes, last close, packages sorted today, trailing-hour pace, and who is
 * scanning right now. One call, because all of it comes off dock_batches +
 * dock_scans. Everything else on that screen already had a hook.
 */

export interface ActiveSorter {
  user_id: string;
  name: string | null;
  scans: number;
  last_scan_at: string;
  zone_code: string | null;
}

export interface DistributionOverview {
  open_batches: number;
  last_closed_at: string | null;
  sorted_today: number;
  pace_per_hour: number;
  operators: ActiveSorter[];
}

const EMPTY: DistributionOverview = {
  open_batches: 0,
  last_closed_at: null,
  sorted_today: 0,
  pace_per_hour: 0,
  operators: [],
};

export function useDistributionOverview(operatorId: string | null) {
  return useQuery<DistributionOverview>({
    queryKey: ['distribution', 'overview', operatorId],
    enabled: !!operatorId,
    // Pace and "who is scanning" go stale fast — this is a floor screen.
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await callRpc<DistributionOverview>(
        createSPAClient(),
        'get_distribution_overview',
        { p_operator_id: operatorId! },
      );
      if (error) throw error;
      return data ?? EMPTY;
    },
  });
}
