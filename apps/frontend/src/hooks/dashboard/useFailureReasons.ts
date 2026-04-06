import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

type FailureReasonsArgs = Database['public']['Functions']['get_failure_reasons']['Args'];

export type FailureReasonRow = {
  reason: string;
  count: number;
  percentage: number;
};

export function useFailureReasons(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'failure-reasons', startDate, endDate],
    queryFn: async () => {
      const args: FailureReasonsArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('get_failure_reasons', args);
      if (error) throw error;
      return data as FailureReasonRow[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
