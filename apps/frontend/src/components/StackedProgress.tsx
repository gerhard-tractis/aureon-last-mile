import { cn } from '@/lib/utils';

/**
 * spec-54 phase 3 — stacked progress bar.
 *
 * Two users in the mocks: "Promesa del día" on the tower (2a) and the driver's
 * route progress (1i). Both need the same thing — one bar showing how a total
 * splits across outcomes, so the shape is read before any number is.
 */

export type SegmentTone = 'success' | 'accent' | 'warning' | 'error' | 'neutral';

export interface ProgressSegment {
  key: string;
  label: string;
  value: number;
  tone: SegmentTone;
}

const TONE_BG: Record<SegmentTone, string> = {
  success: 'bg-status-success',
  accent: 'bg-accent-light',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  neutral: 'bg-surface-raised',
};

interface StackedProgressProps {
  segments: ProgressSegment[];
  /** Bar height in px. 8 on the tower card, 9 on mobile pickup. */
  height?: number;
  showLegend?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function StackedProgress({
  segments,
  height = 8,
  showLegend = false,
  ariaLabel = 'Progreso',
  className,
}: StackedProgressProps) {
  // A zero-value segment would still paint a 0%-wide element; some browsers
  // render that as a 1px sliver of colour, which reads as a real category.
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);

  const summary = visible.map((s) => `${s.label} ${s.value}`).join(' · ');

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        title={summary}
        className="flex overflow-hidden rounded-[5px] bg-surface-raised"
        style={{ height }}
      >
        {/* total > 0 is guaranteed here: visible is empty when it would be 0. */}
        {visible.map((s) => (
          <span
            key={s.key}
            data-testid={`segment-${s.key}`}
            className={cn('block h-full', TONE_BG[s.tone])}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>

      {showLegend && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={cn('h-[7px] w-[7px] flex-none rounded-sm', TONE_BG[s.tone])} />
              <span className="text-[11px] leading-none text-text-secondary">
                {s.label} {s.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
