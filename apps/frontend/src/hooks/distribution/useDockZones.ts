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
  sort_order: number;
}

const DOCK_ZONES_QUERY_OPTIONS = {
  staleTime: 30_000,
} as const;

interface DockZoneJoinRow {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  is_active: boolean;
  operator_id: string;
  sort_order: number;
  dock_zone_comunas: { chile_comunas: { id: string; nombre: string } | null }[];
}

export function useDockZones(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'dock-zones', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_zones')
        .select(`id, name, code, is_consolidation, is_active, operator_id, sort_order,
                 dock_zone_comunas(chile_comunas(id, nombre))`)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('is_consolidation', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('name');
      if (error) throw error;
      return (data as unknown as DockZoneJoinRow[]).map(z => ({
        id: z.id,
        name: z.name,
        code: z.code,
        is_consolidation: z.is_consolidation,
        is_active: z.is_active,
        operator_id: z.operator_id,
        sort_order: z.sort_order,
        comunas: z.dock_zone_comunas
          .map(r => r.chile_comunas)
          .filter((c): c is { id: string; nombre: string } => c !== null),
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

/**
 * Move a dock zone up or down in the operator's display order.
 * Swaps sort_order with the immediate neighbour in the requested direction
 * (only among non-consolidation, non-deleted zones — consolidation always
 * sits at the top of the list per the page-level ORDER BY).
 *
 * No-op when the zone is already at the edge in the chosen direction.
 */
export function useReorderDockZone(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ zoneId, direction }: { zoneId: string; direction: 'up' | 'down' }) => {
      const supabase = createSPAClient();

      // Read the operator's non-consolidation zones in current order — we need
      // both the moving zone and its neighbour to compute the swap.
      // Cast through `as any` to read sort_order — the generated Supabase types
      // for dock_zones don't include this column yet (it's added in
      // 20260428000002_add_sort_order_to_dock_zones.sql); regenerating the
      // types is a separate task. The column is verified to exist at runtime
      // by the migration's validation block.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: zones, error: readError } = await (supabase
        .from('dock_zones') as any)
        .select('id, sort_order')
        .eq('operator_id', operatorId!)
        .eq('is_consolidation', false)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name');
      if (readError) throw readError;

      const list = (zones ?? []) as { id: string; sort_order: number }[];
      const idx = list.findIndex((z) => z.id === zoneId);
      if (idx === -1) return;

      const neighbourIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (neighbourIdx < 0 || neighbourIdx >= list.length) return; // edge — nothing to swap

      const me = list[idx];
      const neighbour = list[neighbourIdx];

      // Two writes — small race window if a concurrent edit reorders the same
      // pair, but the distribution screen has a single operator at a time.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e1 } = await (supabase.from('dock_zones') as any)
        .update({ sort_order: neighbour.sort_order })
        .eq('id', me.id)
        .eq('operator_id', operatorId!);
      if (e1) throw e1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e2 } = await (supabase.from('dock_zones') as any)
        .update({ sort_order: me.sort_order })
        .eq('id', neighbour.id)
        .eq('operator_id', operatorId!);
      if (e2) throw e2;
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
