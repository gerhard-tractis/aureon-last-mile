'use client';

import type { HealthStatus } from '../lib/health';
import type { StageKey } from '../lib/labels.es';
import { STAGE_LABELS } from '../lib/labels.es';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4 — the operation flow rail (mock 2a), replacing StageStrip.
 *
 * Two changes carry the redesign:
 *
 *  - Health moves from a 3px left border to a 3px bar across the foot of the
 *    card. Across seven narrow columns a left border is read as a divider
 *    between cards rather than a property of one.
 *
 *  - Selection is the brand accent, not the info blue. Blue was competing with
 *    the status colours, so a selected healthy stage and a stage in trouble
 *    looked equally "marked". Gold means "you picked this" and never anything
 *    else.
 */

interface StageData {
  key: StageKey;
  count: number;
  delta: string;
  health: HealthStatus;
  /**
   * Packages behind the orders in this stage. null when the stage's items
   * carry no packages at all (the route-based stages), where "0 paquetes"
   * would read as an empty stage rather than as no data.
   */
  packageCount?: number | null;
}

interface StageRailProps {
  stages: StageData[];
  activeStage: StageKey | null;
  onStageChange: (key: StageKey) => void;
}

/** Tinted card body for a stage that needs attention. */
const HEALTH_SURFACE: Record<HealthStatus, string> = {
  ok: 'bg-surface border-border',
  neutral: 'bg-surface border-border',
  warn: 'bg-status-warning-bg border-status-warning-border',
  crit: 'bg-status-error-bg border-status-error-border',
};

/** The foot bar — the primary health signal. */
const HEALTH_BAR: Record<HealthStatus, string> = {
  ok: 'bg-status-success',
  neutral: 'bg-border',
  warn: 'bg-status-warning',
  crit: 'bg-status-error',
};

/** Label and index colour, so health is legible without relying on the bar. */
const HEALTH_TEXT: Record<HealthStatus, string> = {
  ok: 'text-text-secondary',
  neutral: 'text-text-secondary',
  warn: 'text-status-warning-text',
  crit: 'text-status-error-text',
};

const ORDERED_KEYS: StageKey[] = [
  'pickup', 'reception', 'consolidation', 'docks',
  'delivery', 'returns', 'reverse',
];

export function StageRail({ stages, activeStage, onStageChange }: StageRailProps) {
  const stageMap = new Map(stages.map((s) => [s.key, s]));

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[.12em] text-text-muted">
          Flujo de la operación
        </h2>
        <span className="text-[11px] leading-none text-text-muted">
          de la recogida al reparto · clic en una etapa para ver su cola
        </span>
      </div>

      {/* 2 columns on phones, 4 on tablets, 7 on desktop — the breakpoints the
          old StageStrip used, kept so nothing regresses on small screens. */}
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
        {ORDERED_KEYS.map((key, i) => {
          const stage =
            stageMap.get(key) ??
            { key, count: 0, delta: '—', health: 'neutral' as HealthStatus, packageCount: null };
          const isSelected = activeStage === key;

          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              data-health={stage.health}
              onClick={() => onStageChange(key)}
              className={cn(
                'flex min-w-0 cursor-pointer flex-col gap-2 rounded-[10px] border p-3 text-left transition-all duration-150',
                isSelected
                  ? 'border-2 border-accent bg-accent-muted p-[11px] shadow-[0_2px_8px_rgba(230,193,92,.16)]'
                  : cn(HEALTH_SURFACE[stage.health], 'hover:shadow-[0_4px_12px_rgba(0,0,0,.15)]'),
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    'font-mono text-[9.5px] font-semibold leading-none',
                    isSelected ? 'text-accent' : HEALTH_TEXT[stage.health],
                  )}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate text-[11px] leading-none',
                    isSelected
                      ? 'font-semibold text-accent'
                      : cn('font-medium', HEALTH_TEXT[stage.health]),
                  )}
                >
                  {STAGE_LABELS[key]}
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[25px] font-bold leading-none text-text">
                  {stage.count}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate font-mono text-[10.5px] font-medium leading-none',
                    stage.health === 'ok' ? 'text-status-success-text' : HEALTH_TEXT[stage.health],
                  )}
                >
                  {stage.delta}
                </span>
              </div>

              {stage.packageCount != null && (
                <span
                  data-testid={`stage-packages-${key}`}
                  className="whitespace-nowrap font-mono text-[10px] font-medium leading-none text-text-muted"
                >
                  {stage.packageCount} {stage.packageCount === 1 ? 'paquete' : 'paquetes'}
                </span>
              )}

              {/* mt-auto pins the health bar to the card's foot. The grid
                  stretches every card in a row to the same height, but cards
                  without the optional paquetes line have less content — without
                  the pin their bar floats higher than their neighbours'. */}
              <div
                data-testid={`stage-health-${key}`}
                className={cn(
                  'mt-auto h-[3px] rounded-sm',
                  isSelected ? 'bg-accent' : HEALTH_BAR[stage.health],
                )}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
