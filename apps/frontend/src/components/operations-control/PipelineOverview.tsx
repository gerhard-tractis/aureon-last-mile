"use client";

import { usePipelineCounts } from '@/hooks/usePipelineCounts';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { PIPELINE_STAGES } from '@/lib/types/pipeline';
import type { PipelineStageCount } from '@/hooks/usePipelineCounts';
import { RealtimeStatusIndicator } from './RealtimeStatusIndicator';
import { PipelineCard } from './PipelineCard';

interface PipelineOverviewProps {
  operatorId: string;
  date?: string;
  lastFetchedAt?: Date | null;
  realtimeStatus: 'connected' | 'disconnected';
}

const EMPTY_STAGE_COUNTS: Omit<PipelineStageCount, 'status'> = {
  count: 0,
  urgent_count: 0,
  alert_count: 0,
  late_count: 0,
};

export function PipelineOverview({
  operatorId,
  date,
  lastFetchedAt,
  realtimeStatus,
}: PipelineOverviewProps) {
  const { data, isLoading, isError } = usePipelineCounts(operatorId, date);
  const { stageFilter, setStageFilter } = useOpsControlFilterStore();

  // Build full 8-stage list, filling missing stages with zeros
  const stages: PipelineStageCount[] = PIPELINE_STAGES.map((stageConfig) => {
    const found = data?.find((d) => d.status === stageConfig.status);
    return found ?? { status: stageConfig.status, ...EMPTY_STAGE_COUNTS };
  });

  const handleCardClick = (status: PipelineStageCount['status']) => {
    if (stageFilter === status) {
      setStageFilter(null);
    } else {
      setStageFilter(status);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <RealtimeStatusIndicator
          status={realtimeStatus}
          lastFetchedAt={lastFetchedAt}
        />
      </div>

      {isError && (
        <div className="text-sm text-red-500 py-2">Error al cargar etapas</div>
      )}

      {isLoading ? (
        <div
          data-testid="pipeline-grid"
          className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-4"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              data-testid="pipeline-skeleton"
              className="h-24 rounded-lg border-2 border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div
          data-testid="pipeline-grid"
          className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-4"
        >
          {stages.map((stage) => (
            <PipelineCard
              key={stage.status}
              stage={stage}
              isSelected={stageFilter === stage.status}
              onClick={() => handleCardClick(stage.status)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
