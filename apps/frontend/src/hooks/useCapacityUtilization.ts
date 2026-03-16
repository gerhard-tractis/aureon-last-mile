import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { CapacityRow } from './useCapacityCalendar';

/**
 * useCapacityUtilization — fetches capacity utilization for all retailers in a date range.
 * Calls get_capacity_utilization RPC without a client_id filter.
 */
export function useCapacityUtilization(
  operatorId: string | null,
  dateFrom: string,
  dateTo: string
) {
  return useQuery<CapacityRow[]>({
    queryKey: ['capacityUtilization', operatorId, dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_capacity_utilization',
        {
          p_operator_id: operatorId!,
          p_date_from: dateFrom,
          p_date_to: dateTo,
        }
      );
      if (error) throw error;
      return (data as CapacityRow[]) ?? [];
    },
    enabled: !!operatorId && !!dateFrom && !!dateTo,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
