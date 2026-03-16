import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { OrderStatus } from '@/lib/types/pipeline';

export type PipelineStageCount = {
  status: OrderStatus;
  count: number;
  urgent_count: number;
  alert_count: number;
  late_count: number;
};

export function usePipelineCounts(operatorId: string | null, date?: string) {
  return useQuery<PipelineStageCount[]>({
    queryKey: ['pipeline-counts', operatorId, date],
    queryFn: async () => {
      const args: Record<string, unknown> = { p_operator_id: operatorId! };
      if (date) args.p_date = date;

      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_pipeline_counts',
        args,
      );
      if (error) throw error;
      return (data as PipelineStageCount[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
