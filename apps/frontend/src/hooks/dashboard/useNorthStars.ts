import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface NorthStarRow {
  row_type: 'current' | 'prior_month' | 'prior_year';
  period_year: number;
  period_month: number;
  cpo_clp: number | null;
  otif_pct: number | null;
  nps_score: number | null;
  csat_pct: number | null;
  total_orders: number;
  delivered_orders: number;
  failed_orders: number;
  computed_at: string;
}

export function useNorthStars(operatorId: string, year: number, month: number) {
  return useQuery({
    queryKey: ['dashboard-north-stars', operatorId, year, month],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_dashboard_north_stars',
        { p_operator_id: operatorId, p_year: year, p_month: month },
      );
      if (error) throw error;
      const rows = (data as NorthStarRow[]) ?? [];
      return {
        current: rows.find((r) => r.row_type === 'current') ?? null,
        priorMonth: rows.find((r) => r.row_type === 'prior_month') ?? null,
        priorYear: rows.find((r) => r.row_type === 'prior_year') ?? null,
      };
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
