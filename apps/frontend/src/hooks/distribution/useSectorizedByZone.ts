import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export function useSectorizedByZone(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'sectorized-by-zone', operatorId],
    queryFn: async (): Promise<Record<string, number>> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('packages')
        .select('dock_zone_id')
        .eq('operator_id', operatorId!)
        .eq('status', 'sectorizado')
        .is('deleted_at', null)
        .not('dock_zone_id', 'is', null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const pkg of data ?? []) {
        if (pkg.dock_zone_id) {
          counts[pkg.dock_zone_id] = (counts[pkg.dock_zone_id] ?? 0) + 1;
        }
      }
      return counts;
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
