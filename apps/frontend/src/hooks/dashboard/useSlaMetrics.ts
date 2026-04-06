import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

type SlaArgs = Database['public']['Functions']['calculate_sla']['Args'];

export function useSlaMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla', startDate, endDate],
    queryFn: async () => {
      const args: SlaArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_sla', args);
      if (error) throw error;
      return data as number | null;
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
      const args: SlaArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_sla', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
