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
    <div className="relative">
      {/* Edge fades — only visible below md, hint at horizontal scroll */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-surface to-transparent rounded-l-md md:hidden"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-surface to-transparent rounded-r-md md:hidden"
      />

      <div
        className={cn(
          'flex w-full rounded-md border border-border bg-surface',
          // Below md: horizontal scroll with snap. md+: fit all stages side-by-side.
          'overflow-x-auto snap-x snap-mandatory md:overflow-hidden md:snap-none',
          // Hide scrollbar (Webkit) — the edge fades already signal scrollability.
          '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
        )}
      >
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
                'flex flex-col gap-1 border-l-[3px] p-3 text-left transition-colors snap-start',
                // Below md: fixed 144px (w-36) width — cards keep their size, parent scrolls.
                // md+: width:auto + flex-1 distributes equally across the row.
                'w-36 shrink-0 md:w-auto md:flex-1 md:shrink',
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
    </div>
  );
}
