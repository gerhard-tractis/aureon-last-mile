import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

export type CustomerPerformanceRow = {
  retailer_name: string;
  total_orders: number;
  delivered_orders: number;
  first_attempt_deliveries: number;
  failed_deliveries: number;
  sla_pct: number | null;
  fadr_pct: number | null;
};

export function useCustomerPerformance(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'customer-performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('retailer_name, total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .not('retailer_name', 'is', null);
      if (error) throw error;

      type RawRow = { retailer_name: string | null; total_orders: number; delivered_orders: number; first_attempt_deliveries: number; failed_deliveries: number };
      const byRetailer = new Map<string, CustomerPerformanceRow>();
      for (const row of (data ?? []) as RawRow[]) {
        const key = row.retailer_name!;
        const existing = byRetailer.get(key) ?? {
          retailer_name: key,
          total_orders: 0,
          delivered_orders: 0,
          first_attempt_deliveries: 0,
          failed_deliveries: 0,
          sla_pct: null,
          fadr_pct: null,
        };
        existing.total_orders += row.total_orders ?? 0;
        existing.delivered_orders += row.delivered_orders ?? 0;
        existing.first_attempt_deliveries += row.first_attempt_deliveries ?? 0;
        existing.failed_deliveries += row.failed_deliveries ?? 0;
        byRetailer.set(key, existing);
      }

      return Array.from(byRetailer.values()).map(r => ({
        ...r,
        sla_pct: r.total_orders > 0 ? Math.round((r.delivered_orders / r.total_orders) * 1000) / 10 : null,
        fadr_pct: r.total_orders > 0 ? Math.round((r.first_attempt_deliveries / r.total_orders) * 1000) / 10 : null,
      }));
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
