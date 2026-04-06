import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { DASHBOARD_QUERY_OPTIONS, DAILY_CAPACITY, OPERATIONAL_HOURS } from './constants';

export type SecondaryMetrics = {
  capacityPct: number | null;
  capacityTarget: number;
  ordersPerHour: number | null;
  totalOrders: number;
  totalDelivered: number;
  daysInPeriod: number;
  operationalHours: number;
};

async function fetchSecondaryMetrics(
  operatorId: string,
  startDate: string,
  endDate: string
): Promise<SecondaryMetrics> {
  const { data, error } = await createSPAClient()
    .from('performance_metrics')
    .select('total_orders, delivered_orders')
    .eq('operator_id', operatorId)
    .gte('metric_date', startDate)
    .lte('metric_date', endDate)
    .is('retailer_name', null);
  if (error) throw error;

  const totals = (data ?? []).reduce(
    (acc, row) => ({
      totalOrders: acc.totalOrders + ((row as { total_orders: number }).total_orders ?? 0),
      totalDelivered: acc.totalDelivered + ((row as { delivered_orders: number }).delivered_orders ?? 0),
    }),
    { totalOrders: 0, totalDelivered: 0 }
  );

  const daysInPeriod = data?.length || 1;

  return {
    capacityPct: totals.totalOrders > 0
      ? Math.round((totals.totalOrders / (daysInPeriod * DAILY_CAPACITY)) * 1000) / 10
      : null,
    capacityTarget: DAILY_CAPACITY,
    ordersPerHour: totals.totalOrders > 0
      ? Math.round((totals.totalOrders / (daysInPeriod * OPERATIONAL_HOURS)) * 10) / 10
      : null,
    totalOrders: totals.totalOrders,
    totalDelivered: totals.totalDelivered,
    daysInPeriod,
    operationalHours: OPERATIONAL_HOURS,
  };
}

export function useSecondaryMetrics(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics', startDate, endDate],
    queryFn: () => fetchSecondaryMetrics(operatorId!, startDate, endDate),
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useSecondaryMetricsPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics-prev', startDate, endDate],
    queryFn: () => fetchSecondaryMetrics(operatorId!, startDate, endDate),
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
