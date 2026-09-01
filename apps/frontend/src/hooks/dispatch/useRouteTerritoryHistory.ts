import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { TerritoryHistoryEntry } from '@/lib/dispatch/types';

/**
 * spec-72 phase 4 (Decision 6) — "who ran this territory".
 *
 * A single RPC call, `get_route_territory_history(p_route_id, p_operator_id)`
 * (20260903000006_spec72_phase4_territory_history.sql) — one row per comuna
 * this route's LIVE blocks already cover, naming the most recent
 * non-cancelled driver on record for that comuna and how many times they've
 * run it. See that migration's header comment for exactly what is and is
 * not counted (no time window, exact driver_name string match, cancelled
 * routes and this route itself excluded).
 *
 * MANDATORY per spec-72's "Notes for phases 4 and 5": this hook's result
 * only ever covers comunas with a live block. It does NOT know about
 * `RouteBlocksResult.unblocked` orphans (comuna_id set, no block yet) —
 * every consumer of this hook must pair it with `useRouteBlocks`' own
 * orphan count so the gap is visible, not silently absent (see
 * RouteBuilder.tsx / TerritoryStability.tsx).
 */
interface RawTerritoryRow {
  comuna_id: string;
  comuna_name: string;
  driver_name: string;
  run_count: number;
  last_route_date: string;
}

export function useRouteTerritoryHistory(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'route-territory-history', routeId],
    queryFn: async (): Promise<TerritoryHistoryEntry[]> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('get_route_territory_history', {
        p_route_id: routeId!,
        p_operator_id: operatorId!,
      });
      if (error) throw error;

      return ((data ?? []) as RawTerritoryRow[]).map((r) => ({
        comunaId: r.comuna_id,
        comunaName: r.comuna_name,
        driverName: r.driver_name,
        runCount: Number(r.run_count),
        lastRouteDate: r.last_route_date,
      }));
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
