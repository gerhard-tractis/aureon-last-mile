import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface OtifMetrics {
  total_orders: number;
  delivered_orders: number;
  failed_orders: number;
  pending_orders: number;
  on_time_deliveries: number;
  otif_percentage: number | null;
}

export interface PendingOrdersSummary {
  overdue_count: number;
  due_today_count: number;
  due_tomorrow_count: number;
  total_pending: number;
}

const DELIVERY_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;

export function useOtifMetrics(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'otif', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_otif_metrics',
        { p_operator_id: operatorId, p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as OtifMetrics;
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}

export function usePendingOrders(operatorId: string | null) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'pending'],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_pending_orders_summary',
        { p_operator_id: operatorId }
      );
      if (error) throw error;
      return data as PendingOrdersSummary;
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}
