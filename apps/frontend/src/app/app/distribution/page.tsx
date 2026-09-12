'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layers, LayoutGrid, ScanLine, Settings } from 'lucide-react';
import { StatTile } from '@/components/StatTile';
import { EmptyState } from '@/components/EmptyState';
import { OutboundDockGrid } from '@/components/distribution/OutboundDockGrid';
import { DockFilterPills } from '@/components/distribution/DockFilterPills';
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
 * Declared gaps and unit/loading decisions this page makes live in the
 * components/hooks that own them, not here (review — this comment grew
 * past what a page-level doc block should carry and helped push the file
 * over the repo's 300-line cap): `OutboundDockGrid`'s doc comment covers
 * `DETENIDO` and the missing route codes; `SectorizationIncidentsPanel`'s
 * covers `wrongDockCount` and its loading contract; `no-dock-incident-
 * count.ts`'s covers the `usePendingSectorization` unbounded-fetch cost
 * and the zero-zones edge case; `DockFilterPills`'s covers the filter's
 * default and the chip/filter axis mismatch.
 *
 * `unmatchedComunaCount` sums `order_count` across `get_unmatched_comunas`
 * rows (orders), not the row count `Comunas no reconocidas` above uses
 * (distinct comuna strings) — two different units on purpose; see the
 * StatTile's own `detail` text for the disambiguation.
 *
 * spec-68 Fase 2 (Decisión 1) — below `lg` (1024px) this swaps entirely for
 * `DistributionMobileView`'s phone card layout (mock 4c); `useIsBelowLg`
 * picks exactly one of the two trees (the bug of both mounting together
 * has shipped twice, spec-54's 3h and spec-62).
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
  // Default 'all' — see DockFilterPills's doc comment for why.
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
  const filteredZones =
    dockFilter === 'open'
      ? activeZones.filter((z) => (openBatchesByZone?.[z.id] ?? 0) > 0)
      : activeZones;
  const lastClose = timeLabel(overview?.last_closed_at ?? null);
  const openBatches = overview?.open_batches ?? 0;

  // See countNoDockIncidents's doc comment: predicate, cost and the
  // zero-zones edge case it declares rather than fixes.
  const today = todayISOInTimezone(new Date());
  const pendingOrders = (pendingGroups ?? []).flatMap((group) =>
    group.orders.map((order) => ({
      comunaId: order.packages[0]?.comunaId ?? null,
      delivery_date: order.deliveryDate,
    })),
  );
  const noDockCount = countNoDockIncidents(pendingOrders, allZones, today);
  // Order-level, matching noDockCount — not unmatched.length (distinct
  // comuna strings), which the StatTile below keeps using on purpose.
  const unmatchedOrderCount = unmatched.reduce((sum, u) => sum + (u.order_count ?? 0), 0);
  // zonesLoading/zonesError/`!zones` all guard the same class of failure:
  // usePendingSectorization is `enabled` only once zones resolve
  // successfully, so a loading OR failed zones query must not let this
  // read as "no incidents" — see SectorizationIncidentsPanel's doc
  // comment for the isLoading contract itself.
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
            <DockFilterPills value={dockFilter} onChange={setDockFilter} />
          </div>

          {activeZones.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Sin andenes configurados"
              description="Configura tus andenes para comenzar a sectorizar paquetes por zona de entrega."
              action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
            />
          ) : filteredZones.length === 0 ? (
            // Review fix — "Lotes abiertos" with no zone holding an open
            // lote (the start of every shift) used to render an empty
            // grid `div` with no message. Real zones exist; the filter is
            // what's hiding them.
            <EmptyState
              icon={Layers}
              title="Ningún andén con un lote abierto"
              description="El filtro «Lotes abiertos» está ocultando todos los andenes activos — ninguno tiene un lote abierto en este momento."
              action={{ label: 'Ver todas', onClick: () => setDockFilter('all') }}
            />
          ) : (
            <OutboundDockGrid
              zones={filteredZones}
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
          {/* wrongDockCount/onResolve: see SectorizationIncidentsPanel's doc comment. */}
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
