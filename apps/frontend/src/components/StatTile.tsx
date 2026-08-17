import { cn } from '@/lib/utils';

/**
 * spec-54 — the rebrand's KPI tile: mono tracked eyebrow over a large mono
 * figure, in a neutral or status-tinted card.
 *
 * Extracted on its third copy. The tower, quicksort and now Recogida each had
 * their own; three near-identical tiles is where drift starts.
 */

export type TileTone = 'neutral' | 'success' | 'warning' | 'error';

const TONE: Record<TileTone, { box: string; label: string; value: string }> = {
  neutral: {
    box: 'border-border bg-surface',
    label: 'text-text-muted',
    value: 'text-text',
  },
  success: {
    box: 'border-status-success-border bg-status-success-bg',
    label: 'text-status-success-text',
    value: 'text-status-success-text',
  },
  warning: {
    box: 'border-status-warning-border bg-status-warning-bg',
    label: 'text-status-warning-text',
    value: 'text-status-warning-text',
  },
  error: {
    box: 'border-status-error-border bg-status-error-bg',
    label: 'text-status-error-text',
    value: 'text-status-error-text',
  },
};

interface StatTileProps {
  label: string;
  value: number | string;
  tone?: TileTone;
  /** Small trailing unit, e.g. "/h". Kept out of the figure so the number
   *  still scans as a number. */
  unit?: string;
  className?: string;
}

export function StatTile({ label, value, tone = 'neutral', unit, className }: StatTileProps) {
  const t = TONE[tone];
  return (
    <div
      data-testid="stat-tile"
      className={cn('flex flex-col gap-1.5 rounded-[10px] border p-3.5', t.box, className)}
    >
      <span
        className={cn(
          'font-mono text-[9.5px] font-medium uppercase tracking-[.1em] truncate',
          t.label,
        )}
      >
        {label}
      </span>
      <span className={cn('font-mono text-[27px] font-bold leading-none', t.value)}>
        {typeof value === 'number' ? value.toLocaleString('es-CL') : value}
        {unit && <span className="text-xs font-medium text-text-muted"> {unit}</span>}
      </span>
    </div>
  );
}
