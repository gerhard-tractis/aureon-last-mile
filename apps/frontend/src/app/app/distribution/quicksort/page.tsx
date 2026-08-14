'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  QuickSortScanner,
  type QuickSortScanEvent,
} from '@/components/distribution/QuickSortScanner';
import { DockCard } from '@/components/distribution/DockCard';
import { RecentScansPanel } from '@/components/distribution/RecentScansPanel';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useUnmatchedComunas } from '@/hooks/distribution/useUnmatchedComunas';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4.3 — Distribución / modo rápido (mock 1d).
 *
 * The most operationally sensitive screen in the product: used standing, at a
 * distance, with both hands occupied. Everything here follows from that — the
 * scan field is 78px and always focused, the result is the largest element on
 * screen and persists until the next scan, and the dock grid shows where the
 * last package went without the operator having to look away from the bench.
 */

function KpiTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[10px] border p-3.5',
        tone === 'warning'
          ? 'border-status-warning-border bg-status-warning-bg'
          : 'border-border bg-surface',
      )}
    >
      <span
        className={cn(
          'font-mono text-[9.5px] font-medium uppercase tracking-[.1em]',
          tone === 'warning' ? 'text-status-warning-text' : 'text-text-muted',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-[26px] font-bold leading-none',
          tone === 'warning' ? 'text-status-warning-text' : 'text-text',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function QuickSortPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: zones } = useDockZones(operatorId);
  const { data: sectorizedByZone } = useSectorizedByZone(operatorId);
  const { data: kpis } = useDistributionKPIs(operatorId);
  const { data: unmatched } = useUnmatchedComunas(operatorId);

  const [scans, setScans] = useState<QuickSortScanEvent[]>([]);

  const handleScanEvent = useCallback((event: QuickSortScanEvent) => {
    // Newest first, and bounded: a long shift would otherwise grow this list
    // without limit behind a panel that only ever shows the top of it.
    setScans((prev) => [event, ...prev].slice(0, 50));
  }, []);

  if (!operatorId || !zones || !user?.id) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-[78px] w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const consolidationZone = zones.find((z) => z.is_consolidation && z.is_active);
  const activeZones = [
    ...zones.filter((z) => z.is_active && !z.is_consolidation),
    ...(consolidationZone ? [consolidationZone] : []),
  ];

  const lastOkScan = scans.find((s) => s.status === 'ok');
  const sectorized = Object.values(sectorizedByZone ?? {}).reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/app/distribution')}
          aria-label="Volver a Distribución"
        >
          <ArrowLeft className="h-5 w-5 text-text-secondary" />
        </Button>
        <h1 className="font-heading text-lg font-semibold leading-none text-text">Modo rápido</h1>
      </header>

      {/* Scan block — the field and its result, with the shift's numbers
          alongside so the operator never leaves this band of the screen. */}
      <div className="grid flex-none gap-4 border-b border-border bg-surface px-6 py-4 xl:grid-cols-[1fr_420px]">
        <QuickSortScanner
          operatorId={operatorId}
          userId={user.id}
          zones={zones}
          onScanEvent={handleScanEvent}
        />

        <div className="grid grid-cols-2 gap-2.5">
          <KpiTile label="Sectorizados" value={sectorized} />
          <KpiTile label="En esta sesión" value={scans.filter((s) => s.status === 'ok').length} />
          <KpiTile label="Pendientes" value={kpis?.pending ?? 0} tone="warning" />
          <KpiTile label="Consolidación" value={kpis?.consolidation ?? 0} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 px-6 pb-6 pt-4 xl:grid-cols-[1fr_336px]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[.12em] text-text-muted">
              Andenes
            </h2>
            <span className="text-[11px] leading-none text-text-muted">
              {activeZones.length} activos · el andén iluminado es el destino del último escaneo
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeZones.map((zone) => (
              <DockCard
                key={zone.id}
                code={zone.code}
                zoneName={zone.name}
                comunas={zone.comunas.map((c) => c.nombre)}
                packageCount={sectorizedByZone?.[zone.id] ?? 0}
                tone={zone.is_consolidation ? 'warning' : 'neutral'}
                active={lastOkScan?.zoneCode === zone.code}
              />
            ))}
          </div>
        </section>

        <RecentScansPanel scans={scans} unmatchedComunas={unmatched ?? []} />
      </div>
    </div>
  );
}
