// apps/frontend/src/hooks/distribution/useDockZones.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface DockZoneRecord {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  comunas: { id: string; nombre: string }[];
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
        .select(`id, name, code, is_consolidation, is_active, operator_id,
                 dock_zone_comunas(chile_comunas(id, nombre))`)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('is_consolidation', { ascending: false })
        .order('name');
      if (error) throw error;
      return data!.map(z => ({
        id: z.id,
        name: z.name,
        code: z.code,
        is_consolidation: z.is_consolidation,
        is_active: z.is_active,
        operator_id: z.operator_id,
        comunas: ((z as any).dock_zone_comunas ?? []).map((r: any) => r.chile_comunas),
      })) as DockZoneRecord[];
    },
    enabled: !!operatorId,
    ...DOCK_ZONES_QUERY_OPTIONS,
  });
}

export function useCreateDockZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { name: string; code: string; comunaIds: string[] }) => {
      const supabase = createSPAClient();
      const { data: zone, error } = await supabase.from('dock_zones').insert({
        operator_id: operatorId!,
        name: values.name,
        code: values.code,
        is_consolidation: false,
        is_active: true,
      }).select('id').single();
      if (error) throw error;
      if (values.comunaIds.length > 0) {
        const { error: jErr } = await supabase.from('dock_zone_comunas').insert(
          values.comunaIds.map(cid => ({ dock_zone_id: zone!.id, comuna_id: cid }))
        );
        if (jErr) throw jErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}

export function useUpdateDockZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { id: string; name?: string; code?: string; comunaIds?: string[]; is_active?: boolean }) => {
      const { id, comunaIds, ...updates } = values;
      const supabase = createSPAClient();
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('dock_zones')
          .update(updates)
          .eq('id', id)
          .eq('operator_id', operatorId!);
        if (error) throw error;
      }
      if (comunaIds !== undefined) {
        const { error: delError } = await supabase
          .from('dock_zone_comunas')
          .delete()
          .eq('dock_zone_id', id);
        if (delError) throw delError;
        if (comunaIds.length > 0) {
          const { error: insError } = await supabase
            .from('dock_zone_comunas')
            .insert(comunaIds.map(cid => ({ dock_zone_id: id, comuna_id: cid })));
          if (insError) throw insError;
        }
      }
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
        is_active: true,
        // No comunas — column removed; communes via dock_zone_comunas junction table
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}
