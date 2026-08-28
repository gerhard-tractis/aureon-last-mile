'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  QuickSortScanner,
  type QuickSortScanEvent,
} from '@/components/distribution/QuickSortScanner';
import type { QuickSortFlowMode } from '@/hooks/distribution/useQuickSortFlow';
import { QuickSortMobileView } from '@/components/distribution/QuickSortMobileView';
import { SealPositionCard } from '@/components/distribution/SealPositionCard';
import { DockCard } from '@/components/distribution/DockCard';
import { RecentScansPanel } from '@/components/distribution/RecentScansPanel';
import { PendingDockList } from '@/components/distribution/PendingDockList';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useIsBelowLg } from '@/hooks/useViewport';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { useUnmatchedComunas } from '@/hooks/distribution/useUnmatchedComunas';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import {
  useDockVerifications,
  useDockVerificationMutation,
} from '@/hooks/distribution/useDockVerifications';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

/**
 * spec-54 phase 4.3 — Distribución / modo rápido (mock 1d).
 *
 * The most operationally sensitive screen in the product: used standing, at a
 * distance, with both hands occupied. Everything here follows from that — the
 * scan field is 78px and always focused, the result is the largest element on
 * screen and persists until the next scan, and the dock grid shows where the
 * last package went without the operator having to look away from the bench.
 *
 * The pending list under the dock grid is spec-39's, not the mock's. The mock
 * had no equivalent, so the phase 4.3 rebuild dropped it and the operator lost
 * sight of the pile they are working through — along with tap-verify and the
 * manager's manual assign. It is restored here, in the space the mock left
 * empty; spec-39 is still in progress, so the mock never superseded it.
 *
 * spec-68 Fase 5.5 — below `lg` this route renders `QuickSortMobileView`
 * (`4g`/`4h`/`4i`/`4j`) instead of the tree below. Deliberately a branch
 * inside this single default export rather than a second exported
 * component: Next type-checks every export of a page module against its
 * Page contract, so `QuickSortDesktopContent` below stays unexported, the
 * same shape `KpiTile` already used before this change.
 *
 * spec-71 phase 3 review item 2 — this is the console's only entry point:
 * before this, nothing in the product passed `mode='stage'` to
 * `QuickSortScanner`, so the whole staging pass (endpoint, hook branch,
 * `scan_position` render block) was unreachable. A `Tabs` toggle in the
 * header, next to "Modo rápido" — the same local-`useState` + `Tabs`
 * pattern `/app/dispatch`'s own tab row already uses — flips local `mode`
 * between `'sectorize'` (today's comuna sort, unchanged, still the
 * default) and `'stage'` (the wave-cutoff staging pass: scan package, then
 * scan the `load_positions` code the package's route occupies). Deliberately
 * the smallest switch, not a second screen: the rest of this page (andén
 * grid, "Pendientes por sectorizar") stays as-is under either tab — it is
 * sectorize-mode content, but leaving it visible during a staging pass is
 * harmless, and building a stage-specific layout is phase 5's job, not
 * this fix's. Below `lg`, `QuickSortMobileView` is unchanged: it does not
 * accept a mode and never renders `scan_position`, so staging stays a
 * desktop-only entry point for now — a real limit, not an oversight.
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
  const isBelowLg = useIsBelowLg();
  if (isBelowLg) return <QuickSortMobileView />;
  return <QuickSortDesktopContent />;
}

function QuickSortDesktopContent() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: zones } = useDockZones(operatorId);
  const { data: sectorizedByZone } = useSectorizedByZone(operatorId);
  const { data: kpis } = useDistributionKPIs(operatorId);
  const { data: unmatched } = useUnmatchedComunas(operatorId);
  const { data: pendingGroups } = usePendingSectorization(operatorId);
  const today = todayISOInTimezone();
  const { data: verifiedSet } = useDockVerifications(operatorId, today);
  const verifyMutation = useDockVerificationMutation(operatorId ?? '', user?.id ?? '');
  const manualAssign = useManualDockAssignment(operatorId ?? '', user?.id ?? '');

  const [scans, setScans] = useState<QuickSortScanEvent[]>([]);
  const [mode, setMode] = useState<QuickSortFlowMode>('sectorize');

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

  const onTapVerify = (packageId: string) => {
    if (verifiedSet?.has(packageId)) return;
    verifyMutation.mutate({ packageId, source: 'tap' });
  };

  const assignTo = (packageId: string, zoneId: string) =>
    manualAssign.mutateAsync({
      packageId,
      zoneId,
      barcode: packageId,
      isConsolidation: !!zones.find((z) => z.id === zoneId)?.is_consolidation,
    });

  const onManualAssign = manualAssign.canUse
    ? (packageId: string, zoneId: string) => {
        void assignTo(packageId, zoneId);
      }
    : undefined;

  const onManualAssignAll = manualAssign.canUse
    ? async (packageIds: string[], zoneId: string) => {
        await Promise.allSettled(packageIds.map((packageId) => assignTo(packageId, zoneId)));
      }
    : undefined;

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

        {/* spec-71 phase 3 — the staging pass's only entry point. Same
            local-state Tabs pattern as /app/dispatch's header. */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as QuickSortFlowMode)}>
          <TabsList>
            <TabsTrigger value="sectorize">Sectorizar</TabsTrigger>
            <TabsTrigger value="stage">Estibar</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {/* Scan block — the field and its result, with the shift's numbers
          alongside so the operator never leaves this band of the screen. */}
      <div className="grid flex-none gap-4 border-b border-border bg-surface px-6 py-4 xl:grid-cols-[1fr_420px]">
        <QuickSortScanner
          operatorId={operatorId}
          userId={user.id}
          zones={zones}
          onScanEvent={handleScanEvent}
          mode={mode}
        />

        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <KpiTile label="Sectorizados" value={sectorized} />
            <KpiTile label="En esta sesión" value={scans.filter((s) => s.status === 'ok').length} />
            <KpiTile label="Pendientes" value={kpis?.pending ?? 0} tone="warning" />
            <KpiTile label="Consolidación" value={kpis?.consolidation ?? 0} />
          </div>

          {/* spec-71 phase 4 — the position seal, only during the staging
              pass: a position has nothing to seal until the wave cutoff.
              Review fix #1 — the card collapses after a seal or cancel and
              `onCollapse` hands focus back to the package field, which is
              two components away, so it uses the same `querySelector`
              pattern `QuickSortMobileView`'s `onEnterCode` already does. */}
          {mode === 'stage' && (
            <SealPositionCard
              onCollapse={() => {
                document
                  .querySelector<HTMLInputElement>('input[aria-label="Escanear paquete"]')
                  ?.focus();
              }}
            />
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 px-6 pb-6 pt-4 xl:grid-cols-[1fr_336px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex min-w-0 flex-none flex-col gap-3">
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

          {/* The pile still to sort. It takes the height the dock grid leaves
              unused, so the operator sees it without stepping away from the
              bench, and scrolls inside its own box rather than pushing the
              scan field off screen. */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <h2 className="flex-none font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[.12em] text-text-muted">
              Pendientes por sectorizar
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PendingDockList
                groups={pendingGroups ?? []}
                verifiedPackageIds={verifiedSet ?? new Set()}
                onTapVerify={onTapVerify}
                onManualAssign={onManualAssign}
                onManualAssignAll={onManualAssignAll}
                activeZones={activeZones}
              />
            </div>
          </section>
        </div>

        <RecentScansPanel scans={scans} unmatchedComunas={unmatched ?? []} />
      </div>
    </div>
  );
}
