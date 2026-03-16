"use client";

import {
  PackagePlus,
  ScanSearch,
  Warehouse,
  UserCheck,
  Truck,
  CheckCircle,
  Navigation,
  PackageCheck,
} from 'lucide-react';
import { PIPELINE_STAGES } from '@/lib/types/pipeline';
import type { PipelineStageCount } from '@/hooks/usePipelineCounts';

const STAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  PackagePlus,
  ScanSearch,
  Warehouse,
  UserCheck,
  Truck,
  CheckCircle,
  Navigation,
  PackageCheck,
};

interface PipelineCardProps {
  stage: PipelineStageCount;
  isSelected: boolean;
  onClick: () => void;
}

function getCardBorderClass(stage: PipelineStageCount): string {
  if (stage.count === 0) return 'border-gray-300 dark:border-gray-600';
  if (stage.urgent_count > 0 || stage.late_count > 0) return 'border-red-400';
  if (stage.alert_count > 0) return 'border-yellow-400';
  return 'border-green-400';
}

function getFooterContent(stage: PipelineStageCount): {
  text: string;
  className: string;
} {
  if (stage.count === 0) {
    return { text: '—', className: 'text-gray-400' };
  }
  if (stage.urgent_count > 0 || stage.late_count > 0) {
    const total = stage.urgent_count + stage.late_count;
    return { text: `${total} urgentes`, className: 'text-red-500' };
  }
  if (stage.alert_count > 0) {
    return { text: `${stage.alert_count} alertas`, className: 'text-yellow-500' };
  }
  return { text: 'OK', className: 'text-green-500' };
}

export function PipelineCard({ stage, isSelected, onClick }: PipelineCardProps) {
  const stageConfig = PIPELINE_STAGES.find((s) => s.status === stage.status);
  const label = stageConfig?.label ?? stage.status;
  const iconName = stageConfig?.icon ?? 'PackagePlus';
  const Icon = STAGE_ICONS[iconName] ?? PackagePlus;

  const borderClass = getCardBorderClass(stage);
  const footer = getFooterContent(stage);
  const isClickable = stage.count > 0;

  const selectedClass = isSelected ? 'ring-2 ring-offset-1 ring-current' : '';
  const cursorClass = isClickable ? 'cursor-pointer hover:shadow-md' : 'cursor-default';

  return (
    <button
      type="button"
      role="button"
      className={`
        flex flex-col items-start p-3 rounded-lg border-2 bg-card text-card-foreground
        transition-all w-full text-left
        ${borderClass}
        ${selectedClass}
        ${cursorClass}
      `.trim()}
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
    >
      <div className="flex items-center justify-between w-full mb-1">
        <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
        <span data-testid="stage-icon" className="text-muted-foreground">
          <Icon className="w-4 h-4" />
        </span>
      </div>

      <span
        data-testid="stage-count"
        className="text-3xl font-bold leading-none mb-2"
      >
        {stage.count}
      </span>

      <span
        data-testid="stage-footer"
        className={`text-xs font-medium ${footer.className}`}
      >
        {footer.text}
      </span>
    </button>
  );
}
