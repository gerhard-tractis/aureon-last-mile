import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

export type MetricsSummary = {
  totalOrders: number;
  deliveredOrders: number;
  failedDeliveries: number;
} | null;

export type ShortageClaimsMetric = {
  count: number;
  amount: number;
} | null;

export type DailyMetricPoint = {
  date: string;
  value: number;
};

const ALLOWED_METRIC_COLUMNS = [
  'first_attempt_deliveries',
  'shortage_claims_count',
  'shortage_claims_amount_clp',
  'avg_delivery_time_minutes',
  'total_orders',
  'delivered_orders',
  'failed_deliveries',
] as const;

type MetricColumn = (typeof ALLOWED_METRIC_COLUMNS)[number];

export function usePerformanceMetricsSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('total_orders, delivered_orders, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { total_orders: number; delivered_orders: number; failed_deliveries: number }[]).reduce<NonNullable<MetricsSummary>>(
        (acc, row) => ({
          totalOrders: acc.totalOrders + (row.total_orders ?? 0),
          deliveredOrders: acc.deliveredOrders + (row.delivered_orders ?? 0),
          failedDeliveries: acc.failedDeliveries + (row.failed_deliveries ?? 0),
        }),
        { totalOrders: 0, deliveredOrders: 0, failedDeliveries: 0 }
      );
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useShortageClaimsMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { shortage_claims_count: number; shortage_claims_amount_clp: number }[]).reduce(
        (acc, row) => ({
          count: acc.count + (row.shortage_claims_count ?? 0),
          amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
        }),
        { count: 0, amount: 0 }
      ) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useAvgDeliveryTimeMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'avg-delivery-time', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('avg_delivery_time_minutes, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { avg_delivery_time_minutes: number | null; total_orders: number }[];
      let totalTime = 0;
      let totalOrders = 0;
      for (const row of rows) {
        if (row.avg_delivery_time_minutes != null && row.total_orders > 0) {
          totalTime += row.avg_delivery_time_minutes * row.total_orders;
          totalOrders += row.total_orders;
        }
      }
      return totalOrders > 0 ? totalTime / totalOrders : null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useDailyMetricsSeries(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  metricColumn: MetricColumn
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', metricColumn, startDate, endDate],
    queryFn: async () => {
      if (!ALLOWED_METRIC_COLUMNS.includes(metricColumn)) {
        throw new Error(`Invalid metric column: ${metricColumn}`);
      }
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select(`metric_date, ${metricColumn}`)
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        date: row.metric_date as string,
        value: (row[metricColumn] as number) ?? 0,
      })) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useClaimsPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims-prev', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { shortage_claims_count: number; shortage_claims_amount_clp: number }[]).reduce(
        (acc, row) => ({
          count: acc.count + (row.shortage_claims_count ?? 0),
          amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
        }),
        { count: 0, amount: 0 }
      ) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useDeliveryTimePreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'avg-delivery-time-prev', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('avg_delivery_time_minutes, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { avg_delivery_time_minutes: number | null; total_orders: number }[];
      let totalTime = 0;
      let totalOrders = 0;
      for (const row of rows) {
        if (row.avg_delivery_time_minutes != null && row.total_orders > 0) {
          totalTime += row.avg_delivery_time_minutes * row.total_orders;
          totalOrders += row.total_orders;
        }
      }
      return totalOrders > 0 ? totalTime / totalOrders : null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
