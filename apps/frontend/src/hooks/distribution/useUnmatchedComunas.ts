import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface UnmatchedComunaRow {
  comuna_raw: string;
  order_count: number;
}

export function useUnmatchedComunas(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'unmatched-comunas', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('get_unmatched_comunas', {
        p_operator_id: operatorId!,
      });
      if (error) throw error;
      return (data ?? []) as UnmatchedComunaRow[];
    },
    enabled: !!operatorId,
    staleTime: 60_000,
  });
}

export function useMapComunaAlias(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { alias: string; comunaId: string }) => {
      const supabase = createSPAClient();
      const { error } = await supabase.rpc('map_comuna_alias', {
        p_alias: input.alias,
        p_comuna_id: input.comunaId,
        p_source: 'manual',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'unmatched-comunas', operatorId] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}
