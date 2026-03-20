import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface DockBatchRecord {
  id: string;
  dock_zone_id: string;
  status: 'open' | 'closed';
  package_count: number;
  created_at: string;
}

export function useDockBatch(batchId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'batch', batchId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_batches')
        .select('id, dock_zone_id, status, package_count, created_at, dock_zones(name, code)')
        .eq('id', batchId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!batchId && !!operatorId,
    staleTime: 10_000,
  });
}

export function useCreateDockBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { operator_id: string; dock_zone_id: string; created_by: string }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_batches')
        .insert(input)
        .select('id')
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'pending-sectorization', variables.operator_id] });
    },
  });
}

export function useCloseDockBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; operator_id: string }) => {
      const supabase = createSPAClient();
      const { error } = await supabase
        .from('dock_batches')
        .update({ status: 'closed' })
        .eq('id', input.id)
        .eq('operator_id', input.operator_id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'batch', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'kpis', variables.operator_id] });
    },
  });
}
