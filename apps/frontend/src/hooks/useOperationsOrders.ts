import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { OpsControlFilterState } from '@/lib/stores/useOpsControlFilterStore';

export type OperationsOrder = {
  id: string;
  order_number: string;
  retailer_name: string | null;
  customer_name: string;
  comuna: string;
  delivery_date: string;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  status: string;
  leading_status: string;
  status_updated_at: string | null;
  operator_id: string;
  deleted_at: string | null;
};

function getDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

type FilterProps = Pick<
  OpsControlFilterState,
  'datePreset' | 'dateRange' | 'statusFilter' | 'stageFilter'
>;

export function useOperationsOrders(operatorId: string | null, filters: FilterProps) {
  return useQuery<OperationsOrder[]>({
    queryKey: ['operations-orders', operatorId, { datePreset: filters.datePreset, dateRange: filters.dateRange, stageFilter: filters.stageFilter }],
    queryFn: async () => {
      const today = getDateStr(0);
      const tomorrow = getDateStr(1);
      const next6 = getDateStr(6);

      const supabase = createSPAClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from('orders') as any)
        .select(
          'id, order_number, retailer_name, customer_name, comuna, delivery_date, delivery_window_start, delivery_window_end, status, leading_status, status_updated_at, operator_id, deleted_at',
        )
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);

      // Date filter
      if (filters.datePreset === 'today') {
        query = query.gte('delivery_date', today).lte('delivery_date', today);
      } else if (filters.datePreset === 'tomorrow') {
        query = query.gte('delivery_date', tomorrow).lte('delivery_date', tomorrow);
      } else if (filters.datePreset === 'next7') {
        query = query.gte('delivery_date', today).lte('delivery_date', next6);
      } else if (filters.datePreset === 'custom' && filters.dateRange) {
        query = query
          .gte('delivery_date', filters.dateRange.from)
          .lte('delivery_date', filters.dateRange.to);
      }

      // Stage filter
      if (filters.stageFilter != null) {
        query = query.eq('status', filters.stageFilter);
      }

      const result = await query
        .order('delivery_window_start', { ascending: true, nullsFirst: false })
        .order('delivery_date', { ascending: true })
        .limit(200);

      if (result.error) throw result.error;
      return (result.data as OperationsOrder[] | null) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
