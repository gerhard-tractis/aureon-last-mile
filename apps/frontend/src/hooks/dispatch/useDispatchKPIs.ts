import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { OPEN_ROUTE_STATUSES, ON_ROAD_ROUTE_STATUSES } from '@/lib/dispatch/types';

interface DispatchKPIs {
  openRoutes: number;
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

      // Query 2: on-road routes, counted exactly as DispatchInProgressTab
      // lists them — ON_ROAD_ROUTE_STATUSES, no date filter. QA finding #2:
      // this used to add `.eq('route_date', today)`, so a route dispatched
      // yesterday and still on the road counted as 0 here while the tab it
      // labels went on listing it and its "N vehículos en ruta" strip. A
      // route on the road is on the road regardless of which day it was
      // dispatched — the badge has to count what opening the tab shows, or
      // the two numbers can disagree by construction, not by bug.
      const { data: onRoadData, error: onRoadErr } = await supabase
        .from('routes')
        .select('status')
        .eq('operator_id', operatorId!)
        .in('status', [...ON_ROAD_ROUTE_STATUSES])
        .is('deleted_at', null);
      if (onRoadErr) throw onRoadErr;

      const inRoute = onRoadData?.length ?? 0;

      return { openRoutes, inRoute };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
