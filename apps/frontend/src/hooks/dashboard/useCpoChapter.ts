import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface RouteTactics {
  fadr_pct: number | null;
  avg_km_per_route: number | null;
  avg_km_per_stop: number | null;
  avg_orders_per_route: number | null;
}

export function useCpoChapter(operatorId: string, period: DashboardPeriod) {
  const pStart = toISODate(period.start);
  const pEnd = toISODate(period.end);

  const query = useQuery({
    queryKey: ['dashboard-route-tactics', operatorId, pStart, pEnd],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_dashboard_route_tactics',
        { p_operator_id: operatorId, p_start: pStart, p_end: pEnd },
      );
      if (error) throw error;
      const rows = (data as RouteTactics[]) ?? [];
      return rows[0] ?? null;
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    routeTactics: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    fetchStatus: query.fetchStatus,
  };
}
