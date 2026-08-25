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
 * `QuickSortScanner` so the mobile (`4g`/`4h`/`4i`/`4j`) and desktop
 * presentations share one implementation instead of two that drift.
 * Behaviour is unchanged from the pre-extraction component; see that
 * component's own history for the two-step contract this preserves
 * (package scan → destination + armed andén field → andén scan).
 *
 * Two additions beyond the pre-extraction behaviour, both needed by the
 * mobile step-2 screen (spec-68 §5.3/§5.4) and inert for desktop:
 *
 * - `siblingsPending` — count of the scanned package's order siblings still
 *   `en_bodega` (unsorted), read via one extra count-only query right after
 *   the package lookup. Feeds the "Falta N paquete(s) de esta orden" notice.
 * - `rejectedCode` / `markException` — `4i`'s "Marcar excepción y seguir".
 *   A **conservative** reading, called out explicitly in the spec: it
 *   records the rejected andén scan in `dock_scans` with the existing
 *   `scan_result` enum value `wrong_zone` (no new enum value) and returns
 *   to step 1. It does not touch `packages` — no status change, no
 *   `dock_zone_id` write — and it does not create an incident. The package
 *   stays exactly where `determineDockZone` already had it.
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

      // Fase 5.3 — "Falta N paquete(s) de esta orden" on the step-2 screen.
      // One extra read, scoped to this operator and this order, counting
      // siblings still `en_bodega` (not yet sectorized) — not a new hook,
      // not a new table, and read-only.
      const { count: siblingCount } = await supabase
        .from('packages')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', operatorId)
        .eq('order_id', pkg.order_id)
        .eq('status', 'en_bodega')
        .neq('id', pkg.id)
        .is('deleted_at', null);

      setCurrentBatchId(batch.id);
      setCurrentPackage({
        id: pkg.id,
        label: pkg.label,
        orderNumber: order.order_number,
        comunaName: order.chile_comunas?.nombre ?? null,
      });
      setSiblingsPending(siblingCount ?? 0);
      setDestination(matchResult);
      setRejectedCode(null);
      setState('scan_anden');
    } catch {
      setError('Error al procesar — intente de nuevo');
    }
  };

  const handleAndenScan = async (scannedCode: string) => {
    if (!destination || !currentBatchId) return;

    const outcome = validateDockDestination(scannedCode, {
      suggestedZoneCode: destination.zone_code,
      zones,
    });

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

  /**
   * Mobile step-2 footer — "Cancelar y volver al paso 1". No record of any
   * kind (not even `wrong_zone`; the operator hasn't scanned the andén at
   * all here, correctly or not). Still closes the dangling batch that
   * `handlePackageScan` opened, so a cancelled package doesn't leave an
   * `open` `dock_batches` row with zero scans in it forever.
   */
  const cancelStep2 = () => {
    if (currentBatchId) {
      closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
    }
    resetToStepOne();
  };

  /** `4i` — "Marcar excepción y seguir". See the module doc above. */
  const markException = async () => {
    if (!currentBatchId || !currentPackage || !rejectedCode) return;
    setIsMarkingException(true);
    try {
      const supabase = createSPAClient();
      await supabase.from('dock_scans').insert({
        operator_id: operatorId,
        batch_id: currentBatchId,
        package_id: currentPackage.id,
        barcode: currentPackage.label,
        scan_result: 'wrong_zone',
        scanned_by: userId,
        scanned_at: new Date().toISOString(),
      });
    } catch {
      // Best-effort record — the operator still needs to get back to step 1
      // even if this write failed; nothing downstream depends on it.
    } finally {
      closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
      resetToStepOne();
      setIsMarkingException(false);
    }
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
    handlePackageScan,
    handleAndenScan,
    markException,
    cancelStep2,
  };
}
