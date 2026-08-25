'use client';

import { cn } from '@/lib/utils';

/**
 * spec-54 phase 3 — dock tile (mock 1d).
 *
 * Read from a distance while sorting, so the dock code is 30px display type
 * and everything else is support. The tile for the dock the last scan went to
 * is highlighted with the brand accent *and* an ACTIVO badge — gold alone is
 * selection, never status, and never the only channel.
 */

interface DockCardProps {
  /** Short dock code, e.g. "A3" or "CO". */
  code: string;
  zoneName: string;
  comunas?: string[];
  packageCount: number;
  routeCount?: number;
  /** 0–100, clamped. Omit to hide the bar. `dock_zones.capacity` exists
   *  (spec-68 Fase 1) but this card is not wired to it yet — callers still
   *  pass `occupancyPct` (or nothing) directly; an always-0% track would
   *  read as a rendering fault. */
  occupancyPct?: number;
  /** Destination of the most recent scan. */
  active?: boolean;
  /** `warning` is the consolidation dock — not a delivery destination. */
  tone?: 'neutral' | 'warning';
  onClick?: () => void;
  className?: string;
}

export function DockCard({
  code,
  zoneName,
  comunas,
  packageCount,
  routeCount,
  occupancyPct,
  active = false,
  tone = 'neutral',
  onClick,
  className,
}: DockCardProps) {
  const warning = tone === 'warning';
  const pct = occupancyPct == null ? null : Math.max(0, Math.min(100, occupancyPct));

  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'font-heading text-[30px] font-bold leading-none',
            warning ? 'text-status-warning-text' : 'text-text-body',
          )}
        >
          {code}
        </span>
        <div className="flex min-w-0 flex-col gap-1 pt-[3px]">
          <span
            className={cn(
              'text-xs font-semibold leading-none',
              warning ? 'text-status-warning-text' : 'text-text',
            )}
          >
            {zoneName}
          </span>
          {comunas && comunas.length > 0 && (
            <span
              className={cn(
                'text-[10.5px] leading-[1.35]',
                warning ? 'text-status-warning-text' : 'text-text-muted',
              )}
            >
              {comunas.join(' · ')}
            </span>
          )}
        </div>
        {active && (
          <span className="ml-auto flex-none rounded bg-accent px-1.5 py-1 font-mono text-[9px] font-semibold leading-none text-accent-light-foreground">
            ACTIVO
          </span>
        )}
      </div>

      <div className="mt-auto flex items-baseline gap-[7px]">
        <span
          className={cn(
            'font-mono text-[25px] font-bold leading-none',
            warning ? 'text-status-warning-text' : 'text-text',
          )}
        >
          {packageCount}
        </span>
        {routeCount != null && (
          <span
            className={cn(
              'text-[11px] leading-none',
              warning ? 'text-status-warning-text' : 'text-text-muted',
            )}
          >
            paquetes · {routeCount} {routeCount === 1 ? 'ruta' : 'rutas'}
          </span>
        )}
      </div>

      {pct !== null && (
        <div
          className={cn(
            'h-1.5 overflow-hidden rounded',
            warning ? 'bg-status-warning-bg' : 'bg-surface-raised',
          )}
        >
          <span
            data-testid="dock-occupancy"
            className={cn(
              'block h-full rounded',
              active ? 'bg-accent' : warning ? 'bg-status-warning' : 'bg-map-line',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </>
  );

  const classes = cn(
    'flex flex-col gap-3 rounded-xl p-4 text-left transition-shadow',
    warning
      ? 'bg-status-warning-bg border border-status-warning-border'
      : 'bg-surface border border-border',
    active && 'border-2 border-accent shadow-[0_3px_12px_rgba(230,193,92,.18)]',
    onClick && 'hover:bg-surface-raised hover:shadow-[0_4px_12px_rgba(0,0,0,.15)]',
    className,
  );

  // Only a button when it actually does something — an unclickable element in
  // the tab order is noise for keyboard and screen-reader users.
  if (!onClick) {
    return <div className={classes}>{body}</div>;
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}
