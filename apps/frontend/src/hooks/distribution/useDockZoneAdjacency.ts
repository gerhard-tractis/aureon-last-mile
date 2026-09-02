// apps/frontend/src/hooks/distribution/useDockZoneAdjacency.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * spec-73 Phase 3 — dock_zone_adjacency management.
 *
 * Both directions are written and removed by ONE Supabase RPC call each
 * (add_dock_zone_adjacency_pair / remove_dock_zone_adjacency_pair, migration
 * 20260905000001) — never two separate inserts/updates from the client. A
 * two-round-trip write from here is exactly the partial-write asymmetry the
 * RPC exists to make impossible; this hook must never "helpfully" call the
 * RPC twice with the arguments swapped instead of relying on the RPC's own
 * symmetric write.
 *
 * The role gate (canManageDockZoneAdjacency, lib/permissions.ts) is
 * enforced by the RPC itself (SECURITY DEFINER, reads public.users.role) —
 * the UI check at the call site (DockZoneAdjacencyList.tsx) is defence in
 * depth, not the authority, same relationship as canRemoveFromPlan / the
 * DELETE .../packages/[pkgId] route it was modelled on.
 */

export interface DockZoneAdjacencyPair {
  /** id of ONE of the two live rows backing this pair (either direction —
   *  removal is symmetric, so it never matters which). */
  id: string;
  zoneAId: string;
  zoneAName: string;
  zoneACode: string;
  zoneBId: string;
  zoneBName: string;
  zoneBCode: string;
}

interface AdjacencyJoinRow {
  id: string;
  dock_zone_id: string;
  adjacent_zone_id: string;
  dock_zone: { id: string; name: string; code: string } | null;
  adjacent_zone: { id: string; name: string; code: string } | null;
}

/**
 * Fetches every live adjacency row for the operator and dedupes the two
 * directional rows each configured pair produces into one entry — the list
 * renders each pair ONCE, per spec-73's write-time-symmetric decision.
 * Dedup key is the unordered zone-id pair, so it is correct even if some
 * row somehow exists in only one direction (a state add/remove keep from
 * happening, but not one this read needs to trust).
 */
export function useDockZoneAdjacencyPairs(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'dock-zone-adjacency', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_zone_adjacency')
        .select(
          `id, dock_zone_id, adjacent_zone_id,
           dock_zone:dock_zones!dock_zone_adjacency_dock_zone_id_fkey(id, name, code),
           adjacent_zone:dock_zones!dock_zone_adjacency_adjacent_zone_id_fkey(id, name, code)`,
        )
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;

      const rows = data as unknown as AdjacencyJoinRow[];
      const byPairKey = new Map<string, DockZoneAdjacencyPair>();
      for (const row of rows) {
        if (!row.dock_zone || !row.adjacent_zone) continue; // orphaned join, skip rather than crash
        const key = [row.dock_zone_id, row.adjacent_zone_id].sort().join('|');
        if (byPairKey.has(key)) continue; // the reverse direction already represents this pair
        byPairKey.set(key, {
          id: row.id,
          zoneAId: row.dock_zone.id,
          zoneAName: row.dock_zone.name,
          zoneACode: row.dock_zone.code,
          zoneBId: row.adjacent_zone.id,
          zoneBName: row.adjacent_zone.name,
          zoneBCode: row.adjacent_zone.code,
        });
      }
      return Array.from(byPairKey.values()).sort((a, b) => a.zoneACode.localeCompare(b.zoneACode));
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}

export function useAddDockZoneAdjacencyPair(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { dockZoneId: string; adjacentZoneId: string }) => {
      const supabase = createSPAClient();
      const { error } = await supabase.rpc('add_dock_zone_adjacency_pair', {
        p_dock_zone_id: values.dockZoneId,
        p_adjacent_zone_id: values.adjacentZoneId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zone-adjacency', operatorId] });
    },
  });
}

export function useRemoveDockZoneAdjacencyPair(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: { dockZoneId: string; adjacentZoneId: string }) => {
      const supabase = createSPAClient();
      const { error } = await supabase.rpc('remove_dock_zone_adjacency_pair', {
        p_dock_zone_id: values.dockZoneId,
        p_adjacent_zone_id: values.adjacentZoneId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zone-adjacency', operatorId] });
    },
  });
}
