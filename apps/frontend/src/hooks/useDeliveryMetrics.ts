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

export interface OtifByRetailer {
  retailer_name: string;
  total_orders: number;
  delivered: number;
  on_time: number;
  otif_pct: number | null;
}

export interface LateDelivery {
  order_number: string;
  retailer_name: string;
  delivery_date: string;
  completed_date: string;
  days_late: number;
  driver_name: string;
}

export interface OrderDetailRow {
  id: string;
  order_number: string;
  retailer_name: string;
  comuna: string;
  delivery_date: string;
  status: string;
  completed_at: string | null;
  driver_name: string | null;
  route_id: string | null;
  failure_reason: string | null;
  days_delta: number | null;
}

export interface OrdersDetailResult {
  rows: OrderDetailRow[];
  total_count: number;
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

export function useOtifByRetailer(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'otif-by-retailer', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_otif_by_retailer',
        { p_operator_id: operatorId, p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as OtifByRetailer[];
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}

export function useLateDeliveries(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'late-deliveries', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_late_deliveries',
        { p_operator_id: operatorId, p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as LateDelivery[];
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}

export function useOrdersDetail(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  filters: {
    status?: string;
    retailer?: string;
    search?: string;
    overdueOnly?: boolean;
    page?: number;
    pageSize?: number;
  } = {}
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'orders-detail', startDate, endDate, filters],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_orders_detail',
        {
          p_operator_id: operatorId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_status: filters.status ?? null,
          p_retailer: filters.retailer ?? null,
          p_search: filters.search ?? null,
          p_overdue_only: filters.overdueOnly ?? false,
          p_page: filters.page ?? 1,
          p_page_size: filters.pageSize ?? 25,
        }
      );
      if (error) throw error;
      return data as OrdersDetailResult;
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
