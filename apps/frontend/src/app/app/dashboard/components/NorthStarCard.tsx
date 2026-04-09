import { formatNumber } from '@/app/app/dashboard/lib/format';
import { DeltaPill } from './DeltaPill';

interface NorthStarCardProps {
  mode: 'live' | 'placeholder';
  label: string;
  value?: number | null;
  formatter?: (v: number | null) => string;
  momDelta?: number | null;
  yoyDelta?: number | null;
  placeholderHint?: string;
}

export function NorthStarCard({
  mode,
  label,
  value,
  formatter = formatNumber,
  momDelta,
  yoyDelta,
  placeholderHint,
}: NorthStarCardProps) {
  const heroValue = mode === 'live'
    ? (value !== undefined ? formatter(value ?? null) : '—')
    : '—';

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>

      <span className="font-mono tabular-nums text-3xl font-semibold leading-none">
        {heroValue}
      </span>

      {mode === 'live' && (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-8 shrink-0">MoM</span>
            <DeltaPill value={momDelta ?? null} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-8 shrink-0">YoY</span>
            <DeltaPill
              value={yoyDelta ?? null}
              aria-label={
                yoyDelta === null || yoyDelta === undefined
                  ? 'YoY no disponible · menos de 12 meses de datos'
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {mode === 'placeholder' && (
        <div className="flex flex-col gap-1.5 mt-1">
          <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Próximamente
          </span>
          {placeholderHint !== undefined && (
            <span className="text-xs text-muted-foreground">{placeholderHint}</span>
          )}
        </div>
      )}
    </div>
  );
}
