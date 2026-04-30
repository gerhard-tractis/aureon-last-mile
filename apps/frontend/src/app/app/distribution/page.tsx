'use client';
import { MetricCard } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { DockZoneGrid } from '@/components/distribution/DockZoneGrid';
import { ConsolidationPanel } from '@/components/distribution/ConsolidationPanel';
import { UnmappedComunasBanner } from '@/components/distribution/UnmappedComunasBanner';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useConsolidation, useReleaseFromConsolidation } from '@/hooks/distribution/useConsolidation';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useOperatorId } from '@/hooks/useOperatorId';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, Layers, Clock, LayoutGrid, Zap, Settings } from 'lucide-react';
import Link from 'next/link';

export default function DistributionPage() {
  const { operatorId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDistributionKPIs(operatorId);
  const { data: consolidationPackages } = useConsolidation(operatorId);
  const { data: zones } = useDockZones(operatorId);
  const { data: sectorizedCounts } = useSectorizedByZone(operatorId);
  const releaseFromConsolidation = useReleaseFromConsolidation(operatorId ?? '');

  if (!operatorId || kpisLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  const allZones = zones ?? [];
  const activeZones = allZones.filter((z) => !z.is_consolidation && z.is_active);

  // Collect all comunas covered by active zones
  const mappedComunas = new Set(allZones.flatMap((z) => z.comunas));
  // UnmappedComunasBanner: show comunas that appear in packages but have no zone.
  // For now we pass empty — actual unmapped detection belongs in a future enhancement.
  const unmappedComunas: string[] = [];
  void mappedComunas;

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-6xl mx-auto">
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Distribución</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/distribution/batch"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="sm:hidden">Lote</span>
            <span className="hidden sm:inline">Modo lote</span>
          </Link>
          <Link
            href="/app/distribution/quicksort"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="sm:hidden">Rápido</span>
            <span className="hidden sm:inline">Modo rápido</span>
          </Link>
          <Link
            href="/app/distribution/settings"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="sm:hidden">Andenes</span>
            <span className="hidden sm:inline">Configurar andenes</span>
          </Link>
        </div>
      </div>

      <UnmappedComunasBanner unmappedComunas={unmappedComunas} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <MetricCard icon={Package} label="Pendientes de sectorizar" value={kpis?.pending ?? 0} />
        <MetricCard icon={Layers} label="En consolidación" value={kpis?.consolidation ?? 0} />
        <MetricCard
          icon={Clock}
          label="Próximos a despachar"
          value={kpis?.dueSoon ?? 0}
          className="border-status-warning-border bg-status-warning-bg"
        />
      </div>

      {activeZones.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Sin andenes configurados"
          description="Configura tus andenes para comenzar a sectorizar paquetes por zona de entrega."
          action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
        />
      ) : (
        <DockZoneGrid
          zones={activeZones}
          sectorizedCounts={sectorizedCounts}
        />
      )}

      <ConsolidationPanel
        packages={consolidationPackages ?? []}
        onRelease={(ids) => releaseFromConsolidation.mutate(ids)}
      />
    </div>
  );
}
