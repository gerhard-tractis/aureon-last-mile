import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

const LOADING_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;

export function useOrdersLoaded(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-loaded', startDate, endDate],
    queryFn: async () => {
      const { count, error } = await createSPAClient()
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate + 'T00:00:00')
        .lt('created_at', endDate + 'T23:59:59.999')
        .is('deleted_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function usePackagesLoaded(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'packages-loaded', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_packages_loaded_stats',
        { p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as { packages_count: number; avg_per_order: number };
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useOrdersCommitted(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-committed', startDate, endDate],
    queryFn: async () => {
      const { count, error } = await createSPAClient()
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('delivery_date', startDate)
        .lte('delivery_date', endDate)
        .is('deleted_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useActiveClients(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'active-clients', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('orders')
        .select('retailer_name')
        .gte('created_at', startDate + 'T00:00:00')
        .lt('created_at', endDate + 'T23:59:59.999')
        .is('deleted_at', null)
        .not('retailer_name', 'is', null);
      if (error) throw error;
      const unique = new Set((data ?? []).map((r: { retailer_name: string }) => r.retailer_name));
      return unique.size;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useComunasCovered(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'comunas-covered', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('orders')
        .select('comuna')
        .gte('created_at', startDate + 'T00:00:00')
        .lt('created_at', endDate + 'T23:59:59.999')
        .is('deleted_at', null)
        .not('comuna', 'is', null);
      if (error) throw error;
      const unique = new Set((data ?? []).map((r: { comuna: string }) => r.comuna));
      return unique.size;
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useDailyOrdersByClient(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'daily-orders-by-client', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_daily_orders_by_client',
        { p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as { day: string; retailer_name: string; count: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useCommittedOrdersDaily(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'committed-orders-daily', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_committed_orders_daily',
        { p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as { day: string; count: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useOrdersByClient(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-by-client', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_orders_by_client',
        { p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as { retailer_name: string; orders: number; packages: number; pct: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}

export function useOrdersByComuna(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  region?: string
) {
  return useQuery({
    queryKey: ['loading', operatorId, 'orders-by-comuna', startDate, endDate, region ?? null],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_orders_by_comuna',
        { p_start_date: startDate, p_end_date: endDate, p_region: region ?? null }
      );
      if (error) throw error;
      return data as { comuna: string; count: number; pct: number }[];
    },
    enabled: !!operatorId,
    ...LOADING_QUERY_OPTIONS,
  });
}
