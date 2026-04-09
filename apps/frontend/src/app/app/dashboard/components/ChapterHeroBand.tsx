import type { ReactNode } from 'react';
import { DeltaPill } from './DeltaPill';

interface ChapterHeroBandProps {
  value: string;
  momDelta: number | null;
  yoyDelta: number | null;
  meta?: string;
  children?: ReactNode;
}

export function ChapterHeroBand({
  value,
  momDelta,
  yoyDelta,
  meta,
  children,
}: ChapterHeroBandProps) {
  return (
    <div className="border-l-4 border-[var(--color-accent)] pl-6 py-4 md:bg-gradient-to-r md:from-muted/30 md:to-transparent rounded-r-lg flex flex-col gap-3">
      <span className="font-mono tabular-nums text-5xl md:text-6xl font-bold leading-none">
        {value}
      </span>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">MoM</span>
          <DeltaPill value={momDelta} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">YoY</span>
          <DeltaPill
            value={yoyDelta}
            aria-label={
              yoyDelta === null
                ? 'YoY no disponible · menos de 12 meses de datos'
                : undefined
            }
          />
        </div>
        {meta !== undefined && (
          <span className="text-xs text-muted-foreground self-center">{meta}</span>
        )}
      </div>

      {children}
    </div>
  );
}
