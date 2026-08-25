import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { OPEN_ROUTE_STATUSES, ON_ROAD_ROUTE_STATUSES } from '@/lib/dispatch/types';

interface DispatchKPIs {
  openRoutes: number;
  pendingPackages: number;
  dispatchedToday: number;
  inRoute: number;
}

export function useDispatchKPIs(operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'kpis', operatorId],
    queryFn: async (): Promise<DispatchKPIs> => {
      const supabase = createSPAClient();

      // Query 1: routes not yet released to the provider.
      const { data: openData, error: openErr } = await supabase
        .from('routes')
        .select('planned_stops')
        .eq('operator_id', operatorId!)
        .in('status', [...OPEN_ROUTE_STATUSES])
        .is('deleted_at', null);
      if (openErr) throw openErr;

      const openRoutes = openData?.length ?? 0;
      const pendingPackages = (openData ?? []).reduce(
        (sum: number, r: { planned_stops: number | null }) => sum + (r.planned_stops ?? 0),
        0,
      );

      // Query 2: today's released routes. `dispatched` is what spec-70 renamed
      // the old `planned` to, so leaving this at ['in_progress','completed']
      // reported zero for every route sitting at DispatchTrack unstarted.
      const today = new Date().toISOString().split('T')[0];
      const { data: todayData, error: todayErr } = await supabase
        .from('routes')
        .select('status')
        .eq('operator_id', operatorId!)
        .in('status', [...ON_ROAD_ROUTE_STATUSES, 'completed'])
        .eq('route_date', today)
        .is('deleted_at', null);
      if (todayErr) throw todayErr;

      const dispatchedToday = todayData?.length ?? 0;
      const onRoad = new Set<string>(ON_ROAD_ROUTE_STATUSES);
      const inRoute = (todayData ?? []).filter(
        (r: { status: string }) => onRoad.has(r.status),
      ).length;

      return { openRoutes, pendingPackages, dispatchedToday, inRoute };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
