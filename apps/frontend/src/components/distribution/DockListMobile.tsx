'use client';

import { Warehouse } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { DockCapacityBar } from './DockCapacityBar';
import { getDockCapacityStatus, type DockCapacityStatus } from '@/lib/distribution/dock-capacity';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 6 (Decisión 3) — the list `/app/distribution/andenes` is
 * built around. `4c`'s PROCESOS DE LA NAVE row promises an "Andenes"
 * destination the canvas never drew; rather than invent a screen, this is
 * exactly what the spec calls for: one row per ACTIVE andén — code, zone
 * name, sectorized count, and the fill bar only where `capacity` is
 * configured (`DockCapacityBar` already renders nothing without it). No
 * new query — `zones` and `sectorizedCounts` are the same
 * `useDockZones` / `useSectorizedByZone` data every other distribution
 * screen already reads. No map, no card grid: the desktop `DockCard` grid
 * becomes an endless scroll column at 390px, which is why this is a list.
 *
 * The consolidation zone belongs in the list, marked as such (its own
 * subtitle), not hidden — it's still an andén crew look for.
 *
 * spec-96 Fase 8 (`4l`) — `A6`, the unconfigured-capacity row, is a
 * first-class state, not a degraded fallback: no bar (`DockCapacityBar`
 * already renders nothing without a configured capacity), and its own
 * `dock-capacity-unconfigured` region says so instead — plus a
 * "sin capacidad configurada" note in the subtitle slot, matching `4l`'s
 * `A6` exactly.
 *
 * The status chip (review round 1, finding #3, designer's ruling): `4a`'s
 * `A6` is `SIN ABRIR` too, but with capacity *configured* (`0 / 120 paq.`)
 * and a footer reading "lote sin abierto" — so `SIN ABRIR` there means "no
 * open batch", an activity state, not a capacity one. `4l`'s and `4a`'s
 * artboards disagree on what the same label means; escalated to the
 * designer, and until that comes back this list emits `SIN ABRIR` for
 * NOTHING — an unconfigured row has no chip, same as a configured row in
 * the neutral tone, because in both cases this list has no per-zone
 * batch/activity source (same open finding as `OutboundDockGrid`'s, `4a`,
 * Fase 0/4) and the explanatory region already says "unconfigured" on its
 * own. The only chip this list can derive today is `near-full`
 * (`getDockCapacityStatus`'s `warning`/`error` tone). `4l` also draws
 * `EN RITMO`, which needs that same missing activity data — declared open,
 * not guessed.
 */
export interface DockListMobileProps {
  zones: DockZoneRecord[];
  sectorizedCounts: Record<string, number>;
}

type ChipState = 'near-full';

function chipStateFor(status: DockCapacityStatus): ChipState | null {
  if (status.configured && (status.tone === 'warning' || status.tone === 'error')) {
    return 'near-full';
  }
  return null;
}

const CHIP_LABEL: Record<ChipState, string> = {
  'near-full': 'CASI LLENO',
};

const CHIP_CLASS: Record<ChipState, string> = {
  'near-full': 'bg-status-warning-bg text-status-warning-text',
};

export function DockListMobile({ zones, sectorizedCounts }: DockListMobileProps) {
  const activeZones = zones.filter((z) => z.is_active);

  if (activeZones.length === 0) {
    return (
      <EmptyState
        icon={Warehouse}
        title="Sin andenes configurados"
        description="Configura tus andenes para ver su ocupación aquí."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {activeZones.map((zone) => {
        const count = sectorizedCounts[zone.id] ?? 0;
        // Review round 1 (finding #4) — `getDockCapacityStatus` already
        // floors `capacity <= 0` to unconfigured; a hand-rolled `> 0` check
        // duplicated that arithmetic and is exactly what Fase 0's note
        // forbids ("do not reimplement the arithmetic").
        const status = getDockCapacityStatus(count, zone.capacity);
        const configured = status.configured;
        const chipState = chipStateFor(status);
        return (
          <div
            key={zone.id}
            data-testid={`dock-list-row-${zone.id}`}
            className="flex min-h-[64px] flex-col justify-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5"
          >
            <div className="flex items-center gap-3">
              <span className="flex-none rounded-md bg-surface-raised px-2 py-1 font-mono text-[13px] font-bold text-text">
                {zone.code}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-text">
                  {zone.name}
                </span>
                {!configured ? (
                  <span
                    data-testid="dock-unconfigured-note"
                    className="block truncate text-[11.5px] text-text-secondary"
                  >
                    sin capacidad configurada
                  </span>
                ) : (
                  !zone.is_consolidation &&
                  zone.comunas.length > 0 && (
                    <span className="block truncate text-[11.5px] text-text-secondary">
                      {zone.comunas.map((c) => c.nombre).join(' · ')}
                    </span>
                  )
                )}
              </div>
              {zone.is_consolidation && (
                <span className="flex-none rounded-sm border border-status-info-border bg-status-info-bg px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-status-info">
                  Consolidación
                </span>
              )}
              {chipState && (
                <span
                  data-testid="dock-status-chip"
                  data-state={chipState}
                  className={`flex-none rounded-sm px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] ${CHIP_CLASS[chipState]}`}
                >
                  {CHIP_LABEL[chipState]}
                </span>
              )}
              <span className="flex-none font-mono text-[15px] font-bold tabular-nums text-text">
                {count}
              </span>
            </div>
            {configured ? (
              <DockCapacityBar count={count} capacity={zone.capacity} />
            ) : (
              <div
                data-testid="dock-capacity-unconfigured"
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-xs font-semibold text-text-muted">{count} bultos</span>
                <span className="text-[11px] text-text-muted">sin barra hasta configurar</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
