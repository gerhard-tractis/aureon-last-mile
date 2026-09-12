'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layers, LayoutGrid, ScanLine, Settings } from 'lucide-react';
import { StatTile } from '@/components/StatTile';
import { EmptyState } from '@/components/EmptyState';
import { OutboundDockGrid } from '@/components/distribution/OutboundDockGrid';
import { ActiveSortersPanel } from '@/components/distribution/ActiveSortersPanel';
import { ConsolidationPanel } from '@/components/distribution/ConsolidationPanel';
import { SectorizationIncidentsPanel } from '@/components/distribution/SectorizationIncidentsPanel';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useDistributionOverview } from '@/hooks/distribution/useDistributionOverview';
import { useConsolidation, useReleaseFromConsolidation } from '@/hooks/distribution/useConsolidation';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useOpenBatchesByZone } from '@/hooks/distribution/useOpenBatchesByZone';
import { useUnmatchedComunas } from '@/hooks/distribution/useUnmatchedComunas';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useCurrentUserName } from '@/hooks/useCurrentUserName';
import { useIsBelowLg } from '@/hooks/useViewport';
import { Skeleton } from '@/components/ui/skeleton';
import { DistributionMobileView } from '@/components/distribution/DistributionMobileView';
import { countNoDockIncidents } from '@/lib/distribution/no-dock-incident-count';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

/**
 * spec-54 mock 3d, spec-96 fase 4 — Distribución, estado inicial del módulo
 * (`4a`).
 *
 * The screen the floor lead sits on between sorting runs: what is waiting,
 * how fast it is moving, which andenes are filling, and who is on the floor.
 * The primary action is entering Modo rápido (1d), where the work happens.
 *
 * `OutboundDockGrid` is fully wired now: capacity (`dock_zones.capacity` →
 * `lib/distribution/dock-capacity.ts` → `DockCapacityBar`) and, since fase
 * 4, per-zone activity via `useOpenBatchesByZone`. Two things `4a` draws
 * that this screen still cannot: the `DETENIDO` chip (no driver-assignment
 * source exists pre-load — see `OutboundDockGrid`'s doc comment) and the
 * tile footer's route codes (no route field on `DockZoneRecord`).
 *
 * `SectorizationIncidentsPanel`'s `wrongDockCount` also stays unpassed:
 * `quicksort-exception.ts` records the event but no hook reads it back
 * operator-wide yet.
 *
 * Review fix — `unmatchedComunaCount` sums `order_count` across
 * `get_unmatched_comunas` rows rather than counting the rows: the panel's
 * other count (`noDockCount`) is always orders, and mixing units inside
 * one badge/total was a real bug. The `Comunas no reconocidas` StatTile
 * above is untouched — it keeps its own `unmatched.length`, unaffected.
 *
 * `usePendingSectorization` on this landing page is an unbounded fetch
 * (no `.limit()`) reduced to a single integer (`noDockCount`); at prod
 * scale (~61k packages) PostgREST's default row cap would silently
 * truncate it with no error, under-reporting the count. Known cost, not
 * fixed here — the honest fix is a count-only source (ideally folded into
 * `get_distribution_overview`), a follow-up this note exists to not let
 * evaporate. `useOpenBatchesByZone` has no such problem: one row per zone
 * per refetch cycle, and `idx_dock_batches_operator_id` covers it.
 *
 * `incidentsLoading` covers `usePendingSectorization` being `enabled`
 * only once `useDockZones` resolves: while zones are loading, that
 * query's own `isLoading` reports false (never started), so `zonesLoading`
 * is included too — otherwise a real backlog could still read as "Sin
 * incidencias" for a beat.
 *
 * spec-68 Fase 2 (Decisión 1) — below `lg` (1024px) this swaps entirely for
 * `DistributionMobileView`'s phone card layout (mock 4c) instead of
 * squeezing the KPI grid / OutboundDockGrid / ActiveSortersPanel /
 * ConsolidationPanel above into 390px. `useIsBelowLg` picks exactly one of
 * the two trees, and the desktop `<h1>` + panels sit behind `!isBelowLg` —
 * the same bug (two headers stacked on one phone screen) has already
 * shipped twice, in spec-54's 3h and in spec-62.
 */

function timeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export default function DistributionPage() {
  const { operatorId } = useOperatorId();
  const router = useRouter();
  // `4a:180-183` draws `Lotes abiertos` / `Todas` — the two states never
  // co-render in a static mock, so the artboard doesn't settle which one
  // starts active. Default 'all': the artboard's drawn grid shows all 6
  // tiles, including `A6` (SIN ABRIR, no open lote) — starting on 'open'
  // would hide the tile the mock actually shows.
  const [dockFilter, setDockFilter] = useState<'open' | 'all'>('all');
  const isBelowLg = useIsBelowLg();
  const { data: userName = null } = useCurrentUserName();
  const { data: kpis, isLoading: kpisLoading } = useDistributionKPIs(operatorId);
  const { data: overview, isLoading: overviewLoading } = useDistributionOverview(operatorId);
  const { data: consolidationPackages = [] } = useConsolidation(operatorId);
  const { data: zones, isLoading: zonesLoading, isError: zonesError } = useDockZones(operatorId);
  const { data: sectorizedCounts } = useSectorizedByZone(operatorId);
  const { data: openBatchesByZone } = useOpenBatchesByZone(operatorId);
  const { data: unmatched = [], isLoading: unmatchedLoading } = useUnmatchedComunas(operatorId);
  const { data: pendingGroups, isLoading: pendingLoading } = usePendingSectorization(operatorId);
  const releaseFromConsolidation = useReleaseFromConsolidation(operatorId ?? '');

  // spec-68 Fase 2 (Decisión 1) — the SAME padded container the desktop
  // branch below uses. Returned early, not folded into a ternary inside one
  // tree: `DistributionMobileView` must not mount alongside the desktop
  // `<h1>`/KPI grid/OutboundDockGrid/ActiveSortersPanel/ConsolidationPanel —
  // this is the bug that already shipped twice (spec-54 3h, spec-62).
  //
  // Review fix (finding 2) — this branch MUST come before the
  // `!operatorId || kpisLoading` early return below. It used to sit after
  // it, so the desktop skeleton always rendered first and
  // DistributionMobileView's own `isLoading` prop (and its
  // distribution-mobile-hero-skeleton testid) was unreachable in the real
  // app — a loading phone showed desktop skeleton bars. The mobile view
  // owns its own loading state; `!operatorId` counts as loading too, since
  // every query below is gated on operatorId being resolved.
  if (isBelowLg) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileView
          userName={userName}
          kpis={kpis}
          consolidationPackages={consolidationPackages}
          unmatchedComunas={unmatched}
          isLoading={!operatorId || kpisLoading}
        />
      </div>
    );
  }

  if (!operatorId || kpisLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-9 w-64 rounded" />
        <Skeleton className="h-24 w-full rounded-[10px]" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const allZones = zones ?? [];
  const activeZones = allZones.filter((z) => z.is_active);
  const lastClose = timeLabel(overview?.last_closed_at ?? null);
  const openBatches = overview?.open_batches ?? 0;

  // `4a`'s "Sin andén asignado" row. Same predicate PendingMobileList (`4d`)
  // recomputes per order rather than trusting the zone-bucket-level flag
  // (spec-68 Fase 3 review #5) — see countNoDockIncidents's doc comment.
  // Duplicated rather than imported from PendingMobileList.tsx, which is
  // Fase 2's file, not this phase's.
  const today = todayISOInTimezone(new Date());
  const pendingOrders = (pendingGroups ?? []).flatMap((group) =>
    group.orders.map((order) => ({
      comunaId: order.packages[0]?.comunaId ?? null,
      delivery_date: order.deliveryDate,
    })),
  );
  const noDockCount = countNoDockIncidents(pendingOrders, allZones, today);

  // Review fix — order-level throughout the incidents panel. This used to
  // pass `unmatched.length` (distinct comuna STRINGS), while `noDockCount`
  // is always orders — two different units feeding one panel/badge total.
  // get_unmatched_comunas's own `order_count` per row makes the order-level
  // total available without a new query; sum it instead of counting rows.
  // The StatTile above is untouched — it keeps `unmatched.length`, per this
  // phase's note that it's already correct.
  const unmatchedOrderCount = unmatched.reduce((sum, u) => sum + (u.order_count ?? 0), 0);
  // Also gated on zonesLoading: usePendingSectorization is `enabled` only
  // once zones resolve, so while zones are still loading its OWN
  // `isLoading` reports false (never started) rather than "unknown" —
  // exactly the illusion that let a real backlog read as "no incidents".
  //
  // Review fix — `zonesError` closes the same window a settled FAILURE
  // opens: once useDockZones errors, zonesLoading goes false (the query
  // is done, just failed), zones stays undefined, `usePendingSectorization`
  // stays permanently `enabled:false` off the empty `allZones` fallback,
  // so pendingLoading is false too — a failed load, not an idle one,
  // would otherwise still paint the green "Sin incidencias".
  //
  // Known, undeclared-fixed limit: a *successfully* empty zones array
  // (operator genuinely has zero dock zones configured) is NOT an error
  // and isn't caught by any term here either — usePendingSectorization's
  // own `enabled` gate never runs in that state, so `noDockCount` reads 0
  // even though every pending package is, by definition, dock-less. This
  // reads identically to "no incidents" today; fixing it needs either a
  // change to usePendingSectorization's enabling condition (Fase 8's file
  // this round) or a count that doesn't depend on it.
  const incidentsLoading = unmatchedLoading || pendingLoading || zonesLoading || zonesError || !zones;

  // Sorted vs everything the shift has touched, for the percentage the mock
  // shows next to CLASIFICADOS.
  const sortedToday = overview?.sorted_today ?? 0;
  const pending = kpis?.pending ?? 0;
  const totalTouched = sortedToday + pending;
  const sortedPct = totalTouched > 0 ? Math.round((sortedToday / totalTouched) * 100) : null;

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-[1.1] tracking-[-.02em] text-text">
            Distribución
          </h1>
          <p className="text-[12.5px] leading-none text-text-secondary">
            <span className="font-mono font-semibold text-text">{activeZones.length}</span>{' '}
            {activeZones.length === 1 ? 'andén activo' : 'andenes activos'} ·{' '}
            <span className="font-mono font-semibold text-text">{openBatches}</span>{' '}
            {openBatches === 1 ? 'lote abierto' : 'lotes abiertos'}
            {lastClose ? ` · último cierre ${lastClose}` : ''}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href="/app/distribution/settings"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-xs font-semibold text-text-body transition-colors hover:bg-surface-raised"
          >
            <Settings className="h-3.5 w-3.5" />
            Configurar zonas
          </Link>
          <Link
            href="/app/distribution/batch"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-xs font-semibold text-text-body transition-colors hover:bg-surface-raised"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Modo lote
          </Link>
          {/* Modo rápido is where the shift is actually spent. */}
          <Link
            href="/app/distribution/quicksort"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-light px-4 text-[12.5px] font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
          >
            <ScanLine className="h-3.5 w-3.5" />
            Entrar en modo rápido
          </Link>
        </div>
      </div>

      <div className="grid flex-none grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Por clasificar"
          value={pending}
          tone={pending > 0 ? 'warning' : 'neutral'}
          detail="paquetes"
        />
        <StatTile
          label="Clasificados hoy"
          value={sortedToday}
          detail={sortedPct !== null ? `${sortedPct} %` : undefined}
        />
        <StatTile label="Ritmo" value={overview?.pace_per_hour ?? 0} detail="paq./hora" />
        <StatTile
          label="Comunas no reconocidas"
          value={unmatched.length}
          tone={unmatched.length > 0 ? 'error' : 'neutral'}
          detail={
            unmatched.length > 0
              ? `${unmatched.length === 1 ? 'comuna' : 'comunas'} · requieren decisión`
              : undefined
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_320px]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-heading text-[13px] font-semibold leading-none text-text">
              Andenes de salida
            </h2>
            <span className="text-[11px] leading-none text-text-muted">
              capacidad y avance por destino
            </span>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                data-testid="dock-filter-open"
                data-active={dockFilter === 'open'}
                onClick={() => setDockFilter('open')}
                className={
                  'rounded-md border px-2.5 py-1 text-[11px] font-semibold ' +
                  (dockFilter === 'open'
                    ? 'border-border bg-surface-raised text-text'
                    : 'border-border text-text-secondary')
                }
              >
                Lotes abiertos
              </button>
              <button
                type="button"
                data-testid="dock-filter-all"
                data-active={dockFilter === 'all'}
                onClick={() => setDockFilter('all')}
                className={
                  'rounded-md border px-2.5 py-1 text-[11px] font-medium ' +
                  (dockFilter === 'all'
                    ? 'border-border bg-surface-raised text-text'
                    : 'border-border text-text-secondary')
                }
              >
                Todas
              </button>
            </div>
          </div>

          {activeZones.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Sin andenes configurados"
              description="Configura tus andenes para comenzar a sectorizar paquetes por zona de entrega."
              action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
            />
          ) : (
            <OutboundDockGrid
              zones={
                dockFilter === 'open'
                  ? activeZones.filter((z) => (openBatchesByZone?.[z.id] ?? 0) > 0)
                  : activeZones
              }
              sectorizedCounts={sectorizedCounts}
              openBatches={openBatchesByZone}
            />
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-4">
          <ActiveSortersPanel
            sorters={overview?.operators ?? []}
            isLoading={overviewLoading}
          />
          {/* `wrongDockCount` stays unpassed: quicksort-exception.ts records
              the event (dock_scans, scan_result='wrong_zone') but no hook
              reads it back operator-wide yet — a new query, not wiring of
              an existing one. Declared open rather than shipped as 0.

              `onResolve` → /settings is correct for row 1 only (unrecognised
              comuna — settings renders UnmatchedComunasPanel, the alias-
              mapping UI). Row 2 ("comuna resolves, no andén covers it") is
              actually acted on from /app/distribution/pendientes, not
              settings — a single footer action cannot serve both
              destinations, so this deliberately serves row 1's. Per-row
              destinations are a later phase's work, declared here rather
              than silently serving only one type. */}
          <SectorizationIncidentsPanel
            unmatchedComunaCount={unmatchedOrderCount}
            noDockCount={noDockCount}
            isLoading={incidentsLoading}
            onResolve={() => router.push('/app/distribution/settings')}
          />
        </aside>
      </div>

      {/* Consolidation stays full width. Each row carries a package label, a
          date and an action, which wrap onto three lines inside a 320px
          column — this is a work queue, not a sidebar widget. */}
      <ConsolidationPanel
        packages={consolidationPackages ?? []}
        onRelease={(ids) => releaseFromConsolidation.mutate(ids)}
      />
    </div>
  );
}
