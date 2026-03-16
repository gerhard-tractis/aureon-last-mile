import { usePipelineCounts, type PipelineStageCount } from './usePipelineCounts';

export type PriorityCounts = {
  urgent: number;
  alert: number;
  ok: number;
  late: number;
  isLoading: boolean;
  isError: boolean;
};

export function usePriorityCounts(operatorId: string | null, date?: string): PriorityCounts {
  const { data, isLoading, isError } = usePipelineCounts(operatorId, date);

  if (!data || data.length === 0) {
    return { urgent: 0, alert: 0, ok: 0, late: 0, isLoading, isError };
  }

  const urgent = data.reduce((sum: number, s: PipelineStageCount) => sum + s.urgent_count, 0);
  const alert = data.reduce((sum: number, s: PipelineStageCount) => sum + s.alert_count, 0);
  const late = data.reduce((sum: number, s: PipelineStageCount) => sum + s.late_count, 0);
  const totalCount = data.reduce((sum: number, s: PipelineStageCount) => sum + s.count, 0);
  const ok = Math.max(0, totalCount - urgent - alert - late);

  return { urgent, alert, ok, late, isLoading, isError };
}
