'use client';
import { DistributionKPIs } from '@/components/distribution/DistributionKPIs';
import { DockZoneGrid } from '@/components/distribution/DockZoneGrid';
import { ConsolidationPanel } from '@/components/distribution/ConsolidationPanel';
import { UnmappedComunasBanner } from '@/components/distribution/UnmappedComunasBanner';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useConsolidation, useReleaseFromConsolidation } from '@/hooks/distribution/useConsolidation';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useOperatorId } from '@/hooks/useOperatorId';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

export default function DistributionPage() {
  const { operatorId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDistributionKPIs(operatorId);
  const { data: consolidationPackages } = useConsolidation(operatorId);
  const { data: zones } = useDockZones(operatorId);
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
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Distribución</h1>
        <div className="flex gap-2">
          <Link
            href="/app/distribution/batch"
            className="inline-flex items-center px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            Modo lote
          </Link>
          <Link
            href="/app/distribution/quicksort"
            className="inline-flex items-center px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            Modo rápido
          </Link>
          <Link
            href="/app/distribution/settings"
            className="inline-flex items-center px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            Configurar andenes
          </Link>
        </div>
      </div>

      <UnmappedComunasBanner unmappedComunas={unmappedComunas} />

      {activeZones.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No hay andenes configurados.{' '}
          <Link href="/app/distribution/settings" className="text-accent hover:underline">
            Configurar andenes →
          </Link>
        </div>
      )}

      <DistributionKPIs
        pending={kpis?.pending ?? 0}
        consolidation={kpis?.consolidation ?? 0}
        dueSoon={kpis?.dueSoon ?? 0}
      />

      <DockZoneGrid zones={activeZones} />

      <ConsolidationPanel
        packages={consolidationPackages ?? []}
        onRelease={(ids) => releaseFromConsolidation.mutate(ids)}
      />
    </div>
  );
}
