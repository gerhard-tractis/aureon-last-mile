"use client";

import { STAGE_KEYS } from '@/app/app/operations-control/lib/labels.es';
import type { StageKey } from '@/app/app/operations-control/lib/labels.es';
import type { HealthStatus } from '@/app/app/operations-control/lib/health';
import { StageCell } from './StageCell';

export interface TelemetryStripProps {
  stages: Array<{
    key: StageKey;
    count: number;
    delta: string;
    health: HealthStatus;
  }>;
  activeStage: StageKey | null;
  onStageChange: (key: StageKey) => void;
}

// Enforce spec order
const ORDERED_KEYS: StageKey[] = [
  'pickup',
  'reception',
  'consolidation',
  'docks',
  'delivery',
  'returns',
  'reverse',
];

export function TelemetryStrip({ stages, activeStage, onStageChange }: TelemetryStripProps) {
  // Build a lookup map for quick access
  const stageMap = new Map(stages.map((s) => [s.key, s]));

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        background: 'var(--md-panel)',
        border: '1px solid var(--md-hairline)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {ORDERED_KEYS.map((key, i) => {
        const stage = stageMap.get(key) ?? {
          key,
          count: 0,
          delta: '—',
          health: 'neutral' as HealthStatus,
        };
        return (
          <StageCell
            key={key}
            stageKey={key}
            index={i + 1}
            count={stage.count}
            delta={stage.delta}
            health={stage.health}
            isSelected={activeStage === key}
            onSelect={onStageChange}
          />
        );
      })}
    </div>
  );
}

// Re-export for convenience
export { STAGE_KEYS };
