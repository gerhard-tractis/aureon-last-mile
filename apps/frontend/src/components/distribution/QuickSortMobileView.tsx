'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { QuickSortMobile } from './QuickSortMobile';
import { QuickSortMobileDock } from './QuickSortMobileDock';
import { QuickSortMobileStagePosition } from './QuickSortMobileStagePosition';
import {
  useQuickSortFlow,
  type QuickSortFlowMode,
  type QuickSortScanEvent,
} from '@/hooks/distribution/useQuickSortFlow';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useCurrentUserName } from '@/hooks/useCurrentUserName';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * spec-68 Fase 5.2–5.5 — `4g`/`4h`/`4i`/`4j`, quicksort below `lg`.
 *
 * Assembles `useQuickSortFlow` (Fase 5.1) with the mobile presentations —
 * `QuickSortMobile` (step 1), `QuickSortMobileDock` (step 2, sectorize
 * mode's three states) and `QuickSortMobileStagePosition` (step 2, stage
 * mode — spec-71 phase 3 mobile). Owns the "últimos escaneos" session list
 * the same way the desktop route does (`onScanEvent` callback, newest
 * first, capped), and looks up the destination zone's capacity/count for
 * `QuickSortMobileDock` from `zones`/`useSectorizedByZone` — no new
 * queries, same data the desktop screen already reads.
 *
 * spec-71 phase 3 mobile — `mode` is local `useState`, defaulting to
 * `'sectorize'` (Decisión: keep existing behaviour unchanged), the same
 * shape `/app/distribution/quicksort`'s desktop page already uses for its
 * `Tabs` toggle. `QuickSortMobile` renders the switch (its own segmented
 * pill row, not desktop's `Tabs`); this component just owns the state and
 * routes step 2 to whichever destination shape `useQuickSortFlow` armed —
 * `flow.destination` (dock zone) or `flow.positionDestination` (load
 * position) are mutually exclusive per the hook's own contract.
 */
export function QuickSortMobileView() {
  const router = useRouter();
  const { operatorId, userId } = useOperatorId();
  const { data: userName } = useCurrentUserName();
  const { data: zones } = useDockZones(operatorId);
  const { data: sectorizedByZone } = useSectorizedByZone(operatorId);

  const [scans, setScans] = useState<QuickSortScanEvent[]>([]);
  const handleScanEvent = useCallback((event: QuickSortScanEvent) => {
    setScans((prev) => [event, ...prev].slice(0, 50));
  }, []);

  const [mode, setMode] = useState<QuickSortFlowMode>('sectorize');

  const flow = useQuickSortFlow({
    operatorId: operatorId ?? '',
    userId: userId ?? '',
    zones: zones ?? [],
    onScanEvent: handleScanEvent,
    mode,
  });

  if (!operatorId || !userId || !zones) {
    return (
      <div className="flex flex-col gap-4 px-5 py-[22px]">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  const goToDistribution = () => router.push('/app/distribution');

  if (flow.state === 'scan_anden' && flow.destination) {
    // Review fix (finding #5) — `validateDockDestination` only accepts a
    // consolidación zone that is BOTH `is_consolidation` AND `is_active`
    // (same as desktop's own `activeZones` filter). Missing `is_active`
    // here meant a deactivated consolidation zone fed a code the
    // validator rejects as `rejected_wrong_dock` — the screen flipped to
    // the red `4i` state blaming the operator for a scan they never made.
    const activeConsolidation = zones.find((z) => z.is_consolidation && z.is_active);
    const zoneCount = sectorizedByZone?.[flow.destination.zone_id] ?? 0;
    const zoneCapacity = zones.find((z) => z.id === flow.destination!.zone_id)?.capacity ?? null;

    return (
      <QuickSortMobileDock
        destination={flow.destination}
        currentPackage={flow.currentPackage}
        siblingsPending={flow.siblingsPending}
        zoneCount={zoneCount}
        zoneCapacity={zoneCapacity}
        rejectedCode={flow.rejectedCode}
        scans={scans}
        onScanAnden={(code) => { void flow.handleAndenScan(code); }}
        onMarkException={() => { void flow.markException(); }}
        isMarkingException={flow.isMarkingException}
        exceptionError={flow.exceptionError}
        onSendToConsolidation={() => {
          // Review fix (finding #5) — a dead button gave no feedback at
          // all when no active consolidation zone existed.
          if (!activeConsolidation) {
            toast.error('No hay zona de consolidación activa configurada');
            return;
          }
          void flow.handleAndenScan(activeConsolidation.code);
        }}
        onCancel={flow.cancelStep2}
      />
    );
  }

  if (flow.state === 'scan_position' && flow.positionDestination) {
    return (
      <QuickSortMobileStagePosition
        positionDestination={flow.positionDestination}
        currentPackage={flow.currentPackage}
        rejectedCode={flow.rejectedCode}
        scans={scans}
        onScanPosition={(code) => { void flow.handlePositionScan(code); }}
        onCancel={flow.cancelStep2}
      />
    );
  }

  return (
    <QuickSortMobile
      operatorName={userName ?? null}
      sessionCount={flow.counter}
      scans={scans}
      error={flow.error}
      onScan={(code) => { void flow.handlePackageScan(code); }}
      onBack={goToDistribution}
      onEnterCode={() => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Escanear paquete"]');
        input?.focus();
      }}
      onCloseBatch={goToDistribution}
      mode={mode}
      onModeChange={setMode}
    />
  );
}
