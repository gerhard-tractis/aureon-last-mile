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
 * `A6` exactly. That note is scoped to non-consolidation zones only
 * (review round 2, finding #3): the consolidation zone carries
 * `capacity: null` BY DESIGN — no `Editar` action in `Configuración de
 * Andenes` gives it one — so a setup-incomplete warning on a holding area
 * where capacity is meaningless would be a false alarm on every load.
 *
 * **Known deviation from the benchmark, not a coherent fallback** (review
 * round 2, on the designer's ruling): `4l:1236` draws `SIN ABRIR` on `A6`
 * itself — the artboard has no activity signal on that row at all, capacity
 * is the only thing distinguishing it, so a capacity-derived `SIN ABRIR`
 * would reproduce `4l` exactly. This list does not render it, because `4a`
 * (Fase 4, `OutboundDockGrid.tsx`) has separately shipped `SIN ABRIR` as
 * activity-derived ("no open batch") for its own `A6` (which, unlike `4l`'s,
 * *has* a configured capacity in that artboard) — one label meaning two
 * different conditions across the desktop/mobile split was judged worse
 * than a missing chip. So: this row is missing a chip the artboard draws.
 * The only chip this list can derive at all is `near-full`
 * (`getDockCapacityStatus`'s `warning`/`error` tone) — `4l`'s `EN RITMO`
 * needs per-zone batch/activity data this list doesn't receive (same open
 * finding as `OutboundDockGrid`'s, Fase 0/4), so a configured row in the
 * neutral tone also renders no chip, not a guessed one.
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
        // Review round 2, finding #3 — the consolidation zone's
        // `capacity: null` is by design, not a setup gap, so it gets
        // neither the "sin capacidad configurada" note nor the comuna
        // list (it covers no comunas — that's what the `Consolidación`
        // badge already says).
        const showUnconfiguredNote = !configured && !zone.is_consolidation;
        const showComunas = configured && !zone.is_consolidation && zone.comunas.length > 0;
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
                {showUnconfiguredNote && (
                  <span
                    data-testid="dock-unconfigured-note"
                    className="block truncate text-[11.5px] text-text-secondary"
                  >
                    sin capacidad configurada
                  </span>
                )}
                {showComunas && (
                  <span
                    data-testid="dock-comunas-note"
                    className="block truncate text-[11.5px] text-text-secondary"
                  >
                    {zone.comunas.map((c) => c.nombre).join(' · ')}
                  </span>
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
