'use client';

import { cn } from '@/lib/utils';
import { getDockCapacityStatus, type DockCapacityTone } from '@/lib/distribution/dock-capacity';

/**
 * spec-68 Fase 1.5 (Decisión 5, Decisión 8) — the one shared component that
 * renders dock/zone occupancy. Born shared because four screens read it:
 * `4e`, the quicksort step-2 screen, `/andenes`, and optionally the desktop
 * `DockCard`.
 *
 * Renders nothing at all when capacity is not configured — never a bar
 * pinned at 0%, which would read as a rendering fault rather than "unset".
 */
interface DockCapacityBarProps {
  /** Current package count in the zone. */
  count: number;
  /** Max packages this zone can hold. Null (or <= 0) means "not
   *  configured" — the component renders nothing. */
  capacity: number | null;
  className?: string;
}

const FILL_TONE_CLASS: Record<DockCapacityTone, string> = {
  neutral: 'bg-map-line',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
};

const TRACK_TONE_CLASS: Record<DockCapacityTone, string> = {
  neutral: 'bg-surface-raised',
  warning: 'bg-status-warning-bg',
  error: 'bg-status-error-bg',
};

const LABEL_TONE_CLASS: Record<DockCapacityTone, string> = {
  neutral: 'text-text-muted',
  warning: 'text-status-warning-text',
  error: 'text-status-error-text',
};

export function DockCapacityBar({ count, capacity, className }: DockCapacityBarProps) {
  const status = getDockCapacityStatus(count, capacity);

  if (!status.configured || status.tone === null || status.fillPct === null) {
    return null;
  }

  const tone = status.tone;
  const clampedPct = Math.max(0, Math.min(100, status.fillPct));

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-xs font-semibold', LABEL_TONE_CLASS[tone])}>
          {count} / {capacity}
        </span>
        {status.remainingLabel && (
          <span className={cn('text-[11px]', LABEL_TONE_CLASS[tone])}>
            {status.remainingLabel}
          </span>
        )}
      </div>
      <div className={cn('h-1.5 overflow-hidden rounded', TRACK_TONE_CLASS[tone])}>
        <span
          data-testid="dock-capacity-fill"
          className={cn('block h-full rounded', FILL_TONE_CLASS[tone])}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
    </div>
  );
}
