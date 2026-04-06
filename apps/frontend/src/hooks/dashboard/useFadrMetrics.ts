import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';
import { DASHBOARD_QUERY_OPTIONS } from './constants';
import type { DailyMetricPoint } from './useOrdersMetrics';

type FadrArgs = Database['public']['Functions']['calculate_fadr']['Args'];

export function useFadrMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr', startDate, endDate],
    queryFn: async () => {
      const args: FadrArgs = { p_operator_id: operatorId!, p_start_date: startDate, p_end_date: endDate };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_fadr', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr-summary', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('first_attempt_deliveries, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { first_attempt_deliveries: number; total_orders: number }[];
      const totalFa = rows.reduce((sum, r) => sum + (r.first_attempt_deliveries ?? 0), 0);
      const totalOrders = rows.reduce((sum, r) => sum + (r.total_orders ?? 0), 0);
      return { firstAttempt: totalFa, total: totalOrders };
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrDailySeries(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', 'fadr-pct', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('metric_date, first_attempt_deliveries, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => {
        const fa = (row.first_attempt_deliveries as number) ?? 0;
        const total = (row.total_orders as number) ?? 0;
        return { date: row.metric_date as string, value: total > 0 ? (fa / total) * 100 : 0 };
      }) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr-prev', startDate, endDate],
    queryFn: async () => {
      const args: FadrArgs = { p_operator_id: operatorId!, p_start_date: startDate, p_end_date: endDate };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_fadr', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
