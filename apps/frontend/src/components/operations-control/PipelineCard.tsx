"use client";

import type { ComponentType } from 'react';
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

const STAGE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
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

type StatusVariant = 'urgent' | 'alert' | 'ok' | 'empty';

function getStatusVariant(stage: PipelineStageCount): StatusVariant {
  if (stage.count === 0) return 'empty';
  if (stage.urgent_count > 0 || stage.late_count > 0) return 'urgent';
  if (stage.alert_count > 0) return 'alert';
  return 'ok';
}

function getProgressBarClass(variant: StatusVariant): string {
  switch (variant) {
    case 'urgent':
      return 'bg-[var(--color-status-error)]';
    case 'alert':
      return 'bg-[var(--color-status-warning)]';
    case 'ok':
      return 'bg-[var(--color-status-success)]';
    case 'empty':
      return 'bg-border';
  }
}

function getFooterContent(
  stage: PipelineStageCount,
  variant: StatusVariant,
): { text: string; className: string } {
  switch (variant) {
    case 'empty':
      return { text: '—', className: 'text-text-muted' };
    case 'urgent': {
      const total = stage.urgent_count + stage.late_count;
      return { text: `${total} urgentes`, className: 'text-status-error' };
    }
    case 'alert':
      return { text: `${stage.alert_count} alertas`, className: 'text-status-warning' };
    case 'ok':
      return { text: 'OK', className: 'text-status-success' };
  }
}

export function PipelineCard({ stage, isSelected, onClick }: PipelineCardProps) {
  const stageConfig = PIPELINE_STAGES.find((s) => s.status === stage.status);
  const label = stageConfig?.label ?? stage.status;
  const iconName = stageConfig?.icon ?? 'PackagePlus';
  const Icon = STAGE_ICONS[iconName] ?? PackagePlus;

  const variant = getStatusVariant(stage);
  const footer = getFooterContent(stage, variant);
  const isClickable = stage.count > 0;

  const selectedClass = isSelected ? 'border-accent bg-accent/5' : '';
  const cursorClass = isClickable ? 'cursor-pointer hover:shadow-md' : 'cursor-default';

  return (
    <button
      type="button"
      className={`
        flex flex-col items-start bg-surface border border-border rounded-md p-3
        transition-all w-full text-left
        ${selectedClass}
        ${cursorClass}
      `.trim()}
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
    >
      <div className="flex items-center justify-between w-full mb-1">
        <span className="text-xs text-text-muted uppercase truncate">{label}</span>
        <span data-testid="stage-icon" className="text-text-muted">
          <Icon className="w-4 h-4" />
        </span>
      </div>

      <span
        data-testid="stage-count"
        className="font-mono text-lg font-semibold leading-none mb-2"
      >
        {stage.count}
      </span>

      {/* Mini progress bar */}
      <div className="w-full mb-2">
        <div
          data-testid="stage-progress"
          className={`h-1 rounded-full ${getProgressBarClass(variant)}`}
          style={{ width: '100%' }}
        />
      </div>

      <span
        data-testid="stage-footer"
        className={`text-xs font-medium ${footer.className}`}
      >
        {footer.text}
      </span>
    </button>
  );
}
