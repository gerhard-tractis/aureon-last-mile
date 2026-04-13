'use client';

import type { HealthStatus } from '../lib/health';
import type { StageKey } from '../lib/labels.es';
import { STAGE_LABELS } from '../lib/labels.es';
import { cn } from '@/lib/utils';

interface StageData {
  key: StageKey;
  count: number;
  delta: string;
  health: HealthStatus;
}

interface StageStripProps {
  stages: StageData[];
  activeStage: StageKey | null;
  onStageChange: (key: StageKey) => void;
}

const HEALTH_BORDER: Record<HealthStatus, string> = {
  ok:      'border-l-status-success',
  warn:    'border-l-status-warning',
  crit:    'border-l-status-error',
  neutral: 'border-l-border',
};

const HEALTH_BG: Record<HealthStatus, string> = {
  ok:      'bg-status-success-bg',
  warn:    'bg-status-warning-bg',
  crit:    'bg-status-error-bg',
  neutral: 'bg-transparent',
};

const ORDERED_KEYS: StageKey[] = [
  'pickup', 'reception', 'consolidation', 'docks',
  'delivery', 'returns', 'reverse',
];

export function StageStrip({ stages, activeStage, onStageChange }: StageStripProps) {
  const stageMap = new Map(stages.map((s) => [s.key, s]));

  return (
    <div className="flex w-full rounded-md border border-border bg-surface overflow-hidden">
      {ORDERED_KEYS.map((key, i) => {
        const stage = stageMap.get(key) ?? { key, count: 0, delta: '—', health: 'neutral' as HealthStatus };
        const isSelected = activeStage === key;

        return (
          <button
            key={key}
            type="button"
            aria-pressed={isSelected}
            data-health={stage.health}
            onClick={() => onStageChange(key)}
            className={cn(
              'flex flex-1 flex-col gap-1 border-l-[3px] p-3 text-left transition-colors min-w-0',
              'hover:bg-surface-raised cursor-pointer',
              isSelected
                ? 'border-l-status-info bg-status-info-bg'
                : HEALTH_BORDER[stage.health],
              !isSelected && HEALTH_BG[stage.health],
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-xs text-text-muted tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className={cn(
                'text-xs truncate',
                isSelected ? 'text-status-info font-medium' : 'text-text-secondary',
              )}>
                {STAGE_LABELS[key]}
              </span>
            </div>

            <span className="font-mono text-xl font-semibold tabular-nums text-text leading-none">
              {stage.count}
            </span>

            <span className="font-mono text-xs text-text-muted tabular-nums">
              {stage.delta}
            </span>
          </button>
        );
      })}
    </div>
  );
}
