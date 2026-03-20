import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface DistributionKPIs {
  pending: number;
  consolidation: number;
  dueSoon: number;
}

export function useDistributionKPIs(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'kpis', operatorId],
    queryFn: async (): Promise<DistributionKPIs> => {
      const supabase = createSPAClient();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const [pendingResult, consolidationResult, dueSoonResult] = await Promise.all([
        supabase
          .from('packages')
          .select('id', { count: 'exact', head: true })
          .eq('operator_id', operatorId!)
          .eq('status', 'en_bodega')
          .is('deleted_at', null),
        supabase
          .from('packages')
          .select('id', { count: 'exact', head: true })
          .eq('operator_id', operatorId!)
          .eq('status', 'retenido')
          .is('deleted_at', null),
        supabase
          .from('packages')
          .select('id, orders!inner(delivery_date)', { count: 'exact', head: true })
          .eq('operator_id', operatorId!)
          .eq('status', 'retenido')
          .is('deleted_at', null)
          .lte('orders.delivery_date', tomorrowStr),
      ]);

      return {
        pending: pendingResult.count ?? 0,
        consolidation: consolidationResult.count ?? 0,
        dueSoon: dueSoonResult.count ?? 0,
      };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
