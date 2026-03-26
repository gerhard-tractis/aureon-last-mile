import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

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

      // Query 1: Open routes (draft/planned)
      const { data: openData, error: openErr } = await supabase
        .from('routes')
        .select('planned_stops')
        .eq('operator_id', operatorId!)
        .in('status', ['draft', 'planned'])
        .is('deleted_at', null);
      if (openErr) throw openErr;

      const openRoutes = openData?.length ?? 0;
      const pendingPackages = (openData ?? []).reduce(
        (sum: number, r: { planned_stops: number | null }) => sum + (r.planned_stops ?? 0),
        0,
      );

      // Query 2: Today's dispatched routes (in_progress/completed)
      const today = new Date().toISOString().split('T')[0];
      const { data: todayData, error: todayErr } = await supabase
        .from('routes')
        .select('status')
        .eq('operator_id', operatorId!)
        .in('status', ['in_progress', 'completed'])
        .eq('route_date', today)
        .is('deleted_at', null);
      if (todayErr) throw todayErr;

      const dispatchedToday = todayData?.length ?? 0;
      const inRoute = (todayData ?? []).filter(
        (r: { status: string }) => r.status === 'in_progress',
      ).length;

      return { openRoutes, pendingPackages, dispatchedToday, inRoute };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
