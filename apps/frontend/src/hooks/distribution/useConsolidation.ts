import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ConsolidationPackage {
  id: string;
  label: string;
  dock_zone_id: string | null;
  order_id: string;
  delivery_date: string;
}

export function useConsolidation(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'consolidation', operatorId],
    queryFn: async (): Promise<ConsolidationPackage[]> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('packages')
        .select('id, label, dock_zone_id, order_id, orders!inner(delivery_date)')
        .eq('operator_id', operatorId!)
        .eq('status', 'retenido')
        .is('deleted_at', null)
        .order('orders.delivery_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        label: p.label as string,
        dock_zone_id: p.dock_zone_id as string | null,
        order_id: p.order_id as string,
        delivery_date: (p.orders as Record<string, unknown>)?.delivery_date as string,
      }));
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useReleaseFromConsolidation(operatorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (packageIds: string[]) => {
      const supabase = createSPAClient();
      const { error } = await supabase
        .from('packages')
        .update({ status: 'en_bodega', dock_zone_id: null })
        .in('id', packageIds)
        .eq('operator_id', operatorId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'consolidation', operatorId] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'kpis', operatorId] });
    },
  });
}
