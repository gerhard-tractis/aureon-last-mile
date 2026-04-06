"use client";

import { usePipelineCounts } from '@/hooks/usePipelineCounts';
import { useOpsControlFilterStore } from '@/lib/stores/useOpsControlFilterStore';
import { PIPELINE_STAGES } from '@/lib/types/pipeline';
import type { PipelineStageCount } from '@/hooks/usePipelineCounts';
import { PipelineCard } from './PipelineCard';

interface PipelineOverviewProps {
  operatorId: string;
  date?: string;
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
}: PipelineOverviewProps) {
  const { data, isLoading, isError } = usePipelineCounts(operatorId, date);
  const { stageFilter, setStageFilter } = useOpsControlFilterStore();

  // Build full stage list, filling missing stages with zeros
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
    <div>
      {isError && (
        <div className="text-sm text-[var(--color-status-error)] py-2">Error al cargar etapas</div>
      )}

      {isLoading ? (
        <div
          data-testid="pipeline-grid"
          className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              data-testid="pipeline-skeleton"
              className="h-24 rounded-md border border-border bg-surface animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div
          data-testid="pipeline-grid"
          className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2"
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
