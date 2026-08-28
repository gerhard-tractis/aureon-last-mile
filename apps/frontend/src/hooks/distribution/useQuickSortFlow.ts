import { useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import type { DockZone, ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import { useCreateDockBatch, useCloseDockBatch } from '@/hooks/distribution/useDockBatches';
import { useDockScanMutation } from '@/hooks/distribution/useDockScans';
import { recordQuickSortException } from '@/lib/distribution/quicksort-exception';
import { lookupSectorizePackageScan } from '@/lib/distribution/lookup-sectorize-package-scan';
import { submitAndenScan } from '@/lib/distribution/submit-anden-scan';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import type { ExpectedLoadPosition } from '@/lib/dispatch/expected-load-position';
import { lookupStagePackageScan, submitPositionStageScan } from '@/lib/dispatch/stage-package-scan';
import { scanCodesMatch } from '@/lib/scan/normalize-scan-code';

export interface QuickSortScanEvent {
  code: string;
  zoneCode: string | null;
  zoneName: string | null;
  at: Date;
  status: 'ok' | 'error';
  /** Populated on error — shown instead of the dock code in the history. */
  reason?: string;
}

// Destination shown + confirming scan armed in one step. `scan_anden`
// (sectorize) / `scan_position` (stage) are mutually exclusive per `mode`.
export type QuickSortFlowState = 'scan_package' | 'scan_anden' | 'scan_position';

/** `stage` repoints the scan-package-then-scan-destination loop at the
 * wave-cutoff staging pass: destination is `load_positions`, not `dock_zones`. */
export type QuickSortFlowMode = 'sectorize' | 'stage';

export interface QuickSortPackageInfo {
  id: string;
  label: string;
  orderNumber: string;
  comunaName: string | null;
}

export interface UseQuickSortFlowArgs {
  operatorId: string;
  userId: string;
  zones: DockZone[];
  onScanEvent?: (event: QuickSortScanEvent) => void;
  mode?: QuickSortFlowMode;
}

// spec-68 Fase 5.1 — the quicksort state machine, shared by mobile
// (`4g`-`4j`) and desktop. `siblingsPending`/`rejectedCode`/`markException`
// are mobile-only — see `lib/distribution/quicksort-exception.ts`.
export function useQuickSortFlow({ operatorId, userId, zones, onScanEvent, mode = 'sectorize' }: UseQuickSortFlowArgs) {
  const [state, setState] = useState<QuickSortFlowState>('scan_package');
  const [destination, setDestination] = useState<ZoneMatchResult | null>(null);
  // Stage mode's destination, kept separate: every consumer reads
  // `destination` as a `ZoneMatchResult`, and a flow is only ever one mode.
  const [positionDestination, setPositionDestination] = useState<ExpectedLoadPosition | null>(null);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [currentPackage, setCurrentPackage] = useState<QuickSortPackageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);
  const [siblingsPending, setSiblingsPending] = useState(0);
  const [rejectedCode, setRejectedCode] = useState<string | null>(null);
  const [isMarkingException, setIsMarkingException] = useState(false);
  const [exceptionError, setExceptionError] = useState<string | null>(null);

  const createBatch = useCreateDockBatch();
  const closeBatch = useCloseDockBatch();
  const today = todayISOInTimezone();

  // useDockScanMutation requires batchId and zoneId — use current values, fallback to empty string
  const scanMutation = useDockScanMutation(
    operatorId,
    currentBatchId ?? '',
    destination?.zone_id ?? '',
    userId
  );

  function resetToStepOne() {
    setDestination(null);
    setPositionDestination(null);
    setCurrentBatchId(null);
    setCurrentPackage(null);
    setError(null);
    setRejectedCode(null);
    setSiblingsPending(0);
    setExceptionError(null);
    setState('scan_package');
  }

  const handlePackageScan = async (barcode: string) => {
    if (mode === 'stage') return handleStagePackageScan(barcode);
    return handleSectorizePackageScan(barcode);
  };

  // Lookup lives in `lookupSectorizePackageScan` (mirrors
  // `lookupStagePackageScan`); only `createBatch.mutateAsync` stays here.
  const handleSectorizePackageScan = async (barcode: string) => {
    setError(null);
    try {
      const supabase = createSPAClient();
      const result = await lookupSectorizePackageScan(supabase, { operatorId, barcode, zones, today });

      if (!result.ok) {
        setError(result.message);
        if (result.reason === 'NOT_FOUND') {
          onScanEvent?.({
            code: barcode, zoneCode: null, zoneName: null, at: new Date(),
            status: 'error', reason: 'NO ENCONTRADO',
          });
        }
        return;
      }

      const batch = await createBatch.mutateAsync({
        operator_id: operatorId,
        dock_zone_id: result.matchResult.zone_id,
        created_by: userId,
      });
      setCurrentBatchId(batch.id);

      setCurrentPackage({
        id: result.pkg.id,
        label: result.pkg.label,
        orderNumber: result.pkg.orderNumber,
        comunaName: result.pkg.comunaName,
      });
      setSiblingsPending(result.siblingCount);
      setDestination(result.matchResult);
      setRejectedCode(null);
      setState('scan_anden');
    } catch {
      setError('Error al procesar — intente de nuevo');
    }
  };

  // The validate-then-write sequence lives in `submitAndenScan`; this
  // handler is only the state transition on its outcome.
  const handleAndenScan = async (scannedCode: string) => {
    if (!destination || !currentBatchId) return;

    const outcome = await submitAndenScan({
      scannedCode,
      destination,
      zones,
      currentBatchId,
      operatorId,
      packageLabel: currentPackage?.label,
      scanMutateAsync: scanMutation.mutateAsync,
      closeBatchMutate: closeBatch.mutate,
    });

    if (outcome.kind === 'rejected') {
      setError(outcome.message);
      setRejectedCode(outcome.rejectedCode);
      return;
    }

    setError(null);
    setRejectedCode(null);
    onScanEvent?.({
      code: currentPackage?.label ?? '',
      zoneCode: outcome.zoneCode,
      zoneName: outcome.zoneName,
      at: new Date(),
      status: 'ok',
    });
    setCounter(c => c + 1);
    resetToStepOne();
  };

  // `lookupStagePackageScan` finds the package + the position its
  // `planned` route occupies. `NO_POSITION_ASSIGNED` leaves step 1.
  const handleStagePackageScan = async (barcode: string) => {
    setError(null);
    try {
      const supabase = createSPAClient();
      const result = await lookupStagePackageScan(supabase, { operatorId, barcode });

      if (!result.ok) {
        setError(result.message);
        onScanEvent?.({
          code: barcode, zoneCode: null, zoneName: null, at: new Date(),
          status: 'error', reason: result.reason,
        });
        return;
      }

      setCurrentPackage({ id: result.pkg.id, label: result.pkg.label, orderNumber: result.pkg.orderNumber, comunaName: result.pkg.comunaName });
      setPositionDestination(result.position);
      setRejectedCode(null);
      setState('scan_position');
    } catch {
      setError('Error al procesar — intente de nuevo');
    }
  };

  // The match is a local `scanCodesMatch` comparison (QA scanner hyphen
  // corruption). Only a match calls `submitPositionStageScan`, which
  // re-validates authoritatively and writes; the client match is advisory.
  const handlePositionScan = async (scannedCode: string) => {
    if (!positionDestination || !currentPackage) return;

    if (!scanCodesMatch(scannedCode, positionDestination.positionCode)) {
      setError(`Asignación fallida: posición incorrecta. Esperado ${positionDestination.positionCode}.`);
      // The andén reject shows the RAW scan, not its normalized form —
      // matched here too (review item 7).
      setRejectedCode(scannedCode.trim().toUpperCase());
      return;
    }

    setError(null);
    setRejectedCode(null);

    const submitted = await submitPositionStageScan({ packageCode: currentPackage.label, positionCode: scannedCode });
    if (!submitted.ok) {
      setError(submitted.message);
      return;
    }

    onScanEvent?.({
      code: currentPackage.label,
      zoneCode: positionDestination.positionCode,
      zoneName: positionDestination.positionLabel,
      at: new Date(),
      status: 'ok',
    });
    setCounter(c => c + 1);
    resetToStepOne();
  };

  // Mobile step-2 footer — no record, but still closes the dangling batch.
  const cancelStep2 = () => {
    if (currentBatchId) {
      closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
    }
    resetToStepOne();
  };

  // `4i` — "Marcar excepción y seguir". A failure surfaces via
  // `exceptionError` rather than pretending the record was written.
  const markException = async () => {
    if (!currentBatchId || !currentPackage || !rejectedCode) return;
    setIsMarkingException(true);
    setExceptionError(null);

    try {
      await recordQuickSortException({
        operatorId,
        batchId: currentBatchId,
        packageId: currentPackage.id,
        packageLabel: currentPackage.label,
        rejectedCode,
        zones,
        userId,
      });
    } catch {
      setExceptionError('No se pudo registrar la excepción — intenta de nuevo');
      setIsMarkingException(false);
      return;
    }

    closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });

    // E2E finding (QA, 2026-08-25) — emitted only after the write succeeds,
    // or the exception vanishes from "ÚLTIMOS ESCANEOS", inviting a repeat.
    onScanEvent?.({
      code: currentPackage.label,
      zoneCode: null,
      zoneName: null,
      at: new Date(),
      status: 'error',
      reason: `EXCEPCIÓN · ${rejectedCode}`,
    });

    resetToStepOne();
    setIsMarkingException(false);
  };

  return {
    state,
    destination,
    positionDestination,
    currentPackage,
    error,
    counter,
    siblingsPending,
    rejectedCode,
    isMarkingException,
    exceptionError,
    handlePackageScan,
    handleAndenScan,
    handlePositionScan,
    markException,
    cancelStep2,
  };
}
