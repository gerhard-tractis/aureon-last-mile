import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface CapacityRow {
  id: string | null;
  client_id: string;
  retailer_name: string;
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
 * Calls get_capacity_utilization RPC and also queries retailer_daily_capacities
 * directly to obtain row IDs (needed for editing).
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
      const client = createSPAClient();

      // Fetch utilization data via RPC
      // Note: get_capacity_utilization does not accept p_client_id; filter client-side below.
      const { data: rpcData, error: rpcError } = await (client.rpc as CallableFunction)(
        'get_capacity_utilization',
        {
          p_operator_id: operatorId!,
          p_date_from: dateFrom,
          p_date_to: dateTo,
        }
      );
      if (rpcError) throw rpcError;

      // Filter to the selected retailer only
      const filtered = (rpcData ?? []).filter((row: CapacityRow) => row.client_id === clientId);

      // Fetch IDs from retailer_daily_capacities directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: idRows, error: idError } = await (client as any).from('retailer_daily_capacities')
        .select('id, capacity_date')
        .eq('operator_id', operatorId!)
        .eq('client_id', clientId!)
        .gte('capacity_date', dateFrom)
        .lte('capacity_date', dateTo)
        .is('deleted_at', null);
      if (idError) throw idError;

      // Build a map of date → id
      const idByDate = new Map<string, string>();
      if (idRows) {
        for (const row of idRows as { id: string; capacity_date: string }[]) {
          idByDate.set(row.capacity_date, row.id);
        }
      }

      // Merge filtered RPC rows with IDs
      const rows = (filtered as CapacityRow[]).map((row) => ({
        ...row,
        id: idByDate.get(row.capacity_date) ?? null,
      }));

      return rows;
    },
    enabled: !!operatorId && !!clientId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
