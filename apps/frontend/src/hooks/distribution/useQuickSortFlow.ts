import { useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import {
  determineDockZone,
  type DockZone,
  type ZoneMatchResult,
} from '@/lib/distribution/sectorization-engine';
import { useCreateDockBatch, useCloseDockBatch } from '@/hooks/distribution/useDockBatches';
import { useDockScanMutation } from '@/hooks/distribution/useDockScans';
import { validateDockDestination } from '@/lib/distribution/dock-scan-validator';
import { updateBatchDockZone } from '@/lib/distribution/batch-zone';
import { recordQuickSortException } from '@/lib/distribution/quicksort-exception';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

export interface QuickSortScanEvent {
  code: string;
  zoneCode: string | null;
  zoneName: string | null;
  at: Date;
  status: 'ok' | 'error';
  /** Populated on error — shown instead of the dock code in the history. */
  reason?: string;
}

// Two states only: the destination is shown AND the andén scan is armed in a
// single step after the package scan — a confirm tap in between was pure
// friction. The physical andén scan is the confirmation; the validator locks
// assignment to the suggested andén or Consolidación (capacity override).
export type QuickSortFlowState = 'scan_package' | 'scan_anden';

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
}

/**
 * spec-68 Fase 5.1 — the quicksort state machine, extracted out of
 * `QuickSortScanner` so mobile (`4g`/`4h`/`4i`/`4j`) and desktop share one
 * implementation instead of two that drift (package scan → destination +
 * armed andén field → andén scan).
 *
 * Two additions beyond the pre-extraction component, both mobile-only:
 * `siblingsPending` (one extra count-only read after the package lookup,
 * feeding "Falta N paquete(s) de esta orden") and `rejectedCode` /
 * `markException` — `4i`'s "Marcar excepción y seguir", which records the
 * rejection in `dock_scans` (`lib/distribution/quicksort-exception.ts`)
 * without touching `packages` or creating an incident.
 */
export function useQuickSortFlow({ operatorId, userId, zones, onScanEvent }: UseQuickSortFlowArgs) {
  const [state, setState] = useState<QuickSortFlowState>('scan_package');
  const [destination, setDestination] = useState<ZoneMatchResult | null>(null);
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
    setCurrentBatchId(null);
    setCurrentPackage(null);
    setError(null);
    setRejectedCode(null);
    setSiblingsPending(0);
    setExceptionError(null);
    setState('scan_package');
  }

  const handlePackageScan = async (barcode: string) => {
    setError(null);
    try {
      const supabase = createSPAClient();
      const { data, error: dbError } = await supabase
        .from('packages')
        .select(
          'id, label, status, order_id, orders!inner(order_number, comuna_id, delivery_date, chile_comunas(nombre))'
        )
        .eq('operator_id', operatorId)
        .eq('label', barcode)
        .is('deleted_at', null)
        .limit(1);

      if (dbError) {
        setError('Error de red — intente de nuevo');
        return;
      }

      if (!data || data.length === 0) {
        setError('Código no encontrado');
        onScanEvent?.({
          code: barcode, zoneCode: null, zoneName: null, at: new Date(),
          status: 'error', reason: 'NO ENCONTRADO',
        });
        return;
      }

      const pkg = data[0] as {
        id: string;
        label: string;
        status: string;
        order_id: string;
        orders: {
          order_number: string;
          comuna_id: string | null;
          delivery_date: string;
          chile_comunas: { nombre: string } | null;
        };
      };
      const order = pkg.orders;

      const matchResult = determineDockZone(
        { comunaId: order.comuna_id, delivery_date: order.delivery_date },
        zones,
        today
      );

      const batch = await createBatch.mutateAsync({
        operator_id: operatorId,
        dock_zone_id: matchResult.zone_id,
        created_by: userId,
      });

      // Review fix #6 — set BEFORE the sibling-count read below, which
      // used to run first and could throw, leaving currentBatchId null and
      // orphaning an open dock_batches row nothing would ever close.
      setCurrentBatchId(batch.id);

      // Fase 5.3 — "Falta N paquete(s) de esta orden". Siblings still
      // `en_bodega`, scoped to this operator/order — not a new hook or
      // table. Own try/catch (review fix #6): informational only, must
      // not abort the destination the operator already earned.
      let siblingCount = 0;
      try {
        const { count } = await supabase
          .from('packages')
          .select('id', { count: 'exact', head: true })
          .eq('operator_id', operatorId)
          .eq('order_id', pkg.order_id)
          .eq('status', 'en_bodega')
          .neq('id', pkg.id)
          .is('deleted_at', null);
        siblingCount = count ?? 0;
      } catch {
        // best-effort; the incomplete-order notice just won't show this time
      }

      setCurrentPackage({
        id: pkg.id,
        label: pkg.label,
        orderNumber: order.order_number,
        comunaName: order.chile_comunas?.nombre ?? null,
      });
      setSiblingsPending(siblingCount);
      setDestination(matchResult);
      setRejectedCode(null);
      setState('scan_anden');
    } catch {
      setError('Error al procesar — intente de nuevo');
    }
  };

  const handleAndenScan = async (scannedCode: string) => {
    if (!destination || !currentBatchId) return;
    const outcome = validateDockDestination(scannedCode, { suggestedZoneCode: destination.zone_code, zones });

    if (outcome.kind === 'rejected_wrong_dock') {
      setError(
        `Asignación fallida: andén incorrecto. Esperado ${outcome.expectedCode} o Consolidación.`
      );
      setRejectedCode(scannedCode.trim().toUpperCase());
      return;
    }

    setError(null);
    setRejectedCode(null);

    // For consolidación redirect, switch the batch's zone first so the trigger
    // routes the package to retenido/consolidación instead of sectorizado.
    if (outcome.kind === 'accepted_consolidation') {
      await updateBatchDockZone({
        batchId: currentBatchId,
        zoneId: outcome.zoneId,
        operatorId,
      });
    }

    if (currentPackage?.label) {
      try {
        await scanMutation.mutateAsync({
          barcode: currentPackage.label,
          ...(outcome.kind === 'accepted_consolidation'
            ? { redirectReason: 'manual_consolidation' as const }
            : {}),
        });
      } catch {
        // scan mutation failure should not block the flow
      }
    }

    closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
    onScanEvent?.({
      code: currentPackage?.label ?? '',
      zoneCode: destination.zone_code,
      zoneName: destination.zone_name,
      at: new Date(),
      status: 'ok',
    });
    setCounter(c => c + 1);
    resetToStepOne();
  };

  /** Mobile step-2 footer — "Cancelar y volver al paso 1". No record of
   *  any kind; still closes the dangling batch so it doesn't stay open
   *  forever with zero scans. */
  const cancelStep2 = () => {
    if (currentBatchId) {
      closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
    }
    resetToStepOne();
  };

  /**
   * `4i` — "Marcar excepción y seguir". See the module doc above and
   * `lib/distribution/quicksort-exception.ts` for the row shape and the
   * review fixes (findings #1/#2: throws instead of swallowing a
   * PostgREST `{ error }`, and resolves `rejectedCode` to `dock_zone_id`).
   * A failure here is surfaced via `exceptionError` and leaves the flow in
   * the rejected state (batch left open, field still armed) rather than
   * pretending the record was written.
   */
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

    // E2E finding (QA, 2026-08-25). Emitted only AFTER the write succeeded,
    // so the history never claims a record that does not exist — the same
    // rule the failure branch above follows by returning early.
    //
    // Without this the exception vanished from the operator's view the
    // instant it was marked: the row reached `dock_scans`, the red
    // rejection card was replaced by step 1, and "ÚLTIMOS ESCANEOS" still
    // showed its empty state. On a screen whose entire job is to say what
    // just happened, that reads as "nothing happened" — and the natural
    // response is to mark it again.
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
    currentPackage,
    error,
    counter,
    siblingsPending,
    rejectedCode,
    isMarkingException,
    exceptionError,
    handlePackageScan,
    handleAndenScan,
    markException,
    cancelStep2,
  };
}
