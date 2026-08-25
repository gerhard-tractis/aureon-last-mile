import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ConsolidationPackage {
  id: string;
  label: string;
  dock_zone_id: string | null;
  order_id: string;
  delivery_date: string;
  /** spec-68 Fase 4 — the order's comuna, for `4f`'s "comuna → andén" line.
   *  Null when the order's comuna wasn't matched (same vocabulary as
   *  usePendingSectorization's PendingPackage). */
  comunaId: string | null;
  comunaName: string | null;
}

export function useConsolidation(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'consolidation', operatorId],
    queryFn: async (): Promise<ConsolidationPackage[]> => {
      const supabase = createSPAClient();
      // No server-side ORDER BY here: ordering the parent by an embedded
      // column (`order=orders.delivery_date`) is invalid PostgREST syntax and
      // 400s every request — the panel rendered permanently empty. The list
      // is small; sort client-side instead.
      const { data, error } = await supabase
        .from('packages')
        .select('id, label, dock_zone_id, order_id, orders!inner(delivery_date, comuna_id, chile_comunas(nombre))')
        .eq('operator_id', operatorId!)
        .eq('status', 'retenido')
        .is('deleted_at', null);
      if (error) throw error;
      return (data ?? [])
        .map((p: Record<string, unknown>) => {
          const orders = p.orders as Record<string, unknown> | undefined;
          const chileComunas = orders?.chile_comunas as Record<string, unknown> | null | undefined;
          return {
            id: p.id as string,
            label: p.label as string,
            dock_zone_id: p.dock_zone_id as string | null,
            order_id: p.order_id as string,
            delivery_date: orders?.delivery_date as string,
            comunaId: (orders?.comuna_id as string | null) ?? null,
            comunaName: (chileComunas?.nombre as string | null) ?? null,
          };
        })
        .sort((a, b) => (a.delivery_date ?? '').localeCompare(b.delivery_date ?? ''));
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
