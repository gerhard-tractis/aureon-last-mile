import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 30000,
} as const;

export function useOperatorId() {
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const claims = session?.user?.app_metadata?.claims;
      setOperatorId(claims?.operator_id ?? null);
      setRole(claims?.role ?? null);
    });
  }, []);

  return { operatorId, role };
}

export function useSlaMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla', startDate, endDate],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('calculate_sla', {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr', startDate, endDate],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('calculate_fadr', {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export type MetricsSummary = {
  totalOrders: number;
  deliveredOrders: number;
  failedDeliveries: number;
} | null;

export function usePerformanceMetricsSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'performance', startDate, endDate],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('performance_metrics')
        .select('total_orders, delivered_orders, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;

      return data.reduce<NonNullable<MetricsSummary>>(
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

export function useSlaPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla-prev', startDate, endDate],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('calculate_sla', {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
