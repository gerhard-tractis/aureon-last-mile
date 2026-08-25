'use client';

import Link from 'next/link';
import { Layers, LayoutGrid, ScanLine, Settings } from 'lucide-react';
import { StatTile } from '@/components/StatTile';
import { EmptyState } from '@/components/EmptyState';
import { OutboundDockGrid } from '@/components/distribution/OutboundDockGrid';
import { ActiveSortersPanel } from '@/components/distribution/ActiveSortersPanel';
import { ConsolidationPanel } from '@/components/distribution/ConsolidationPanel';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useDistributionOverview } from '@/hooks/distribution/useDistributionOverview';
import { useConsolidation, useReleaseFromConsolidation } from '@/hooks/distribution/useConsolidation';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useUnmatchedComunas } from '@/hooks/distribution/useUnmatchedComunas';
import { useOperatorId } from '@/hooks/useOperatorId';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * spec-54 mock 3d — Distribución, estado inicial del módulo.
 *
 * The screen the floor lead sits on between sorting runs: what is waiting,
 * how fast it is moving, which andenes are filling, and who is on the floor.
 * The primary action is entering Modo rápido (1d), where the work happens.
 *
 * Not rendered yet: the mock's "168 / 180 paq." denominator, its fill bar
 * and the CASI LLENO badge. `dock_zones.capacity` and its admin surface
 * (DockZoneForm) shipped in spec-68 Fase 1, but this screen still isn't
 * wired to lib/distribution/dock-capacity.ts / DockCapacityBar — that's a
 * follow-up, not a schema gap.
 */

function timeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export default function DistributionPage() {
  const { operatorId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDistributionKPIs(operatorId);
  const { data: overview, isLoading: overviewLoading } = useDistributionOverview(operatorId);
  const { data: consolidationPackages } = useConsolidation(operatorId);
  const { data: zones } = useDockZones(operatorId);
  const { data: sectorizedCounts } = useSectorizedByZone(operatorId);
  const { data: unmatched = [] } = useUnmatchedComunas(operatorId);
  const releaseFromConsolidation = useReleaseFromConsolidation(operatorId ?? '');

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
          label="Excepciones de andén"
          value={unmatched.length}
          tone={unmatched.length > 0 ? 'error' : 'neutral'}
          detail={unmatched.length > 0 ? 'requieren decisión' : undefined}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_320px]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-heading text-[13px] font-semibold leading-none text-text">
              Andenes de salida
            </h2>
            <span className="text-[11px] leading-none text-text-muted">avance por destino</span>
          </div>

          {activeZones.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Sin andenes configurados"
              description="Configura tus andenes para comenzar a sectorizar paquetes por zona de entrega."
              action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
            />
          ) : (
            <OutboundDockGrid zones={activeZones} sectorizedCounts={sectorizedCounts} />
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-4">
          <ActiveSortersPanel
            sorters={overview?.operators ?? []}
            isLoading={overviewLoading}
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
