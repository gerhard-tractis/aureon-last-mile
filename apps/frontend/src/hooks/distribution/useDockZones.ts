// apps/frontend/src/hooks/distribution/useDockZones.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface DockZoneRecord {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  comunas: string[];
  is_active: boolean;
  operator_id: string;
}

const DOCK_ZONES_QUERY_OPTIONS = {
  staleTime: 30_000,
} as const;

export function useDockZones(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'dock-zones', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_zones')
        .select('id, name, code, is_consolidation, comunas, is_active, operator_id')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('is_consolidation', { ascending: false })
        .order('name');
      if (error) throw error;
      return data as DockZoneRecord[];
    },
    enabled: !!operatorId,
    ...DOCK_ZONES_QUERY_OPTIONS,
  });
}

export function useCreateDockZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { name: string; code: string; comunas: string[] }) => {
      const supabase = createSPAClient();
      const { error } = await supabase.from('dock_zones').insert({
        operator_id: operatorId!,
        name: values.name,
        code: values.code,
        comunas: values.comunas,
        is_consolidation: false,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}

export function useUpdateDockZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { id: string; name?: string; code?: string; comunas?: string[]; is_active?: boolean }) => {
      const { id, ...updates } = values;
      const supabase = createSPAClient();
      const { error } = await supabase
        .from('dock_zones')
        .update(updates)
        .eq('id', id)
        .eq('operator_id', operatorId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}

export function useDeleteDockZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (zoneId: string) => {
      const supabase = createSPAClient();
      const { error } = await supabase
        .from('dock_zones')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', zoneId)
        .eq('operator_id', operatorId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}

export function useEnsureConsolidationZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = createSPAClient();
      const { data: existing } = await supabase
        .from('dock_zones')
        .select('id')
        .eq('operator_id', operatorId!)
        .eq('is_consolidation', true)
        .is('deleted_at', null)
        .limit(1);
      if (existing && existing.length > 0) return;
      const { error } = await supabase.from('dock_zones').insert({
        operator_id: operatorId!,
        name: 'Consolidación',
        code: 'CONSOL',
        is_consolidation: true,
        comunas: [],
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}
