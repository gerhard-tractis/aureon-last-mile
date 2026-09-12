import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * spec-96 fase 4 — per-zone open-batch count for `4a`'s `SIN ABRIR` /
 * `EN RITMO` activity chip.
 *
 * `get_distribution_overview` (`useDistributionOverview`) already
 * aggregates `open_batches`, but only as one operator-wide scalar — the
 * page's own doc comment records that this was fase 0's first mistake,
 * rendering `SIN ABIRR` on every active dock. Mirrors
 * `useSectorizedByZone`'s shape exactly: a small, per-zone count over an
 * existing table, not a new RPC.
 */
export function useOpenBatchesByZone(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'open-batches-by-zone', operatorId],
    queryFn: async (): Promise<Record<string, number>> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_batches')
        .select('dock_zone_id')
        .eq('operator_id', operatorId!)
        .eq('status', 'open')
        .is('deleted_at', null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const batch of (data ?? []) as { dock_zone_id: string }[]) {
        counts[batch.dock_zone_id] = (counts[batch.dock_zone_id] ?? 0) + 1;
      }
      return counts;
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
