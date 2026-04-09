"use client";

import type { HealthStatus } from '@/app/app/operations-control/lib/health';
import type { StageKey } from '@/app/app/operations-control/lib/labels.es';
import { STAGE_LABELS } from '@/app/app/operations-control/lib/labels.es';

export interface StageCellProps {
  stageKey: StageKey;
  index: number;
  count: number;
  delta: string;
  health: HealthStatus;
  isSelected: boolean;
  onSelect: (key: StageKey) => void;
}

const HEALTH_BORDER: Record<HealthStatus, string> = {
  ok:      'var(--color-status-success)',
  warn:    'var(--color-status-warning)',
  crit:    'var(--color-status-error)',
  neutral: 'var(--color-border)',
};

const HEALTH_BG: Record<HealthStatus, string> = {
  ok:      'rgba(0,210,140,0.05)',
  warn:    'rgba(255,185,0,0.05)',
  crit:    'rgba(210,30,60,0.08)',
  neutral: 'transparent',
};

export function StageCell({
  stageKey,
  index,
  count,
  delta,
  health,
  isSelected,
  onSelect,
}: StageCellProps) {
  const borderColor = isSelected ? 'var(--color-status-info)' : HEALTH_BORDER[health];
  const bg = isSelected ? 'rgba(30,100,255,0.08)' : HEALTH_BG[health];

  return (
    <button
      type="button"
      role="button"
      aria-pressed={isSelected}
      data-health={health}
      onClick={() => onSelect(stageKey)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '12px 14px',
        background: bg,
        border: 'none',
        borderLeft: `3px solid ${borderColor}`,
        cursor: 'pointer',
        textAlign: 'left',
        minWidth: '120px',
        flex: 1,
        transition: 'background 0.15s',
      }}
    >
      {/* Index + stage name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            color: 'var(--color-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {String(index).padStart(2, '0')}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.75rem',
            color: isSelected ? 'var(--color-status-info)' : 'var(--color-text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {STAGE_LABELS[stageKey]}
        </span>
      </div>

      {/* Count */}
      <span
        data-testid="stage-count"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-text)',
          lineHeight: 1,
        }}
      >
        {count}
      </span>

      {/* Delta */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {delta}
      </span>
    </button>
  );
}
