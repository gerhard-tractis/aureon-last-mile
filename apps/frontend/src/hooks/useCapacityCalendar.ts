import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface CapacityRow {
  capacity_date: string;
  daily_capacity: number;
  actual_orders: number;
  utilization_pct: number;
  source: 'rule' | 'manual';
}

/**
 * Derives the first and last day of a month from a 'YYYY-MM' string.
 */
function getMonthDateRange(month: string): { dateFrom: string; dateTo: string } {
  const [year, mon] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  // Last day: day 0 of next month = last day of current month
  const lastDay = new Date(year, mon, 0).getDate();
  const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { dateFrom, dateTo };
}

/**
 * useCapacityCalendar — fetches capacity utilization for a specific retailer/month.
 * Calls get_capacity_utilization RPC with the full month date range.
 */
export function useCapacityCalendar(
  operatorId: string | null,
  clientId: string | null,
  month: string
) {
  const { dateFrom, dateTo } = getMonthDateRange(month);

  return useQuery<CapacityRow[]>({
    queryKey: ['capacityCalendar', operatorId, clientId, month],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_capacity_utilization',
        {
          p_operator_id: operatorId!,
          p_client_id: clientId!,
          p_date_from: dateFrom,
          p_date_to: dateTo,
        }
      );
      if (error) throw error;
      return (data as CapacityRow[]) ?? [];
    },
    enabled: !!operatorId && !!clientId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
