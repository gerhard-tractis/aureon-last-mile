import { validateDockDestination } from './dock-scan-validator';
import { updateBatchDockZone } from './batch-zone';
import type { DockZone, ZoneMatchResult } from './sectorization-engine';

/**
 * spec-71 phase 3 review item 6 — `useQuickSortFlow`'s `handleAndenScan`,
 * split the same way `handleSectorizePackageScan` was: the validate-then-
 * write sequence moves here, the hook keeps only the state transition.
 * `scanMutateAsync`/`closeBatchMutate` are passed in rather than imported —
 * they are React Query mutations bound to the calling hook, the one piece
 * that genuinely cannot move into a plain function — so this stays a pure
 * orchestration step the hook's own suite can still exercise through its
 * mocked mutations, unchanged.
 */
export type AndenScanOutcome =
  | { kind: 'rejected'; message: string; rejectedCode: string }
  | { kind: 'accepted'; zoneCode: string; zoneName: string };

export interface SubmitAndenScanInput {
  scannedCode: string;
  destination: ZoneMatchResult;
  zones: DockZone[];
  currentBatchId: string;
  operatorId: string;
  packageLabel: string | undefined;
  scanMutateAsync: (input: {
    barcode: string;
    redirectReason?: 'manual_consolidation';
  }) => Promise<unknown>;
  closeBatchMutate: (input: { id: string; operator_id: string }) => void;
}

export async function submitAndenScan(input: SubmitAndenScanInput): Promise<AndenScanOutcome> {
  const outcome = validateDockDestination(input.scannedCode, {
    suggestedZoneCode: input.destination.zone_code,
    zones: input.zones,
  });

  if (outcome.kind === 'rejected_wrong_dock') {
    return {
      kind: 'rejected',
      message: `Asignación fallida: andén incorrecto. Esperado ${outcome.expectedCode} o Consolidación.`,
      rejectedCode: input.scannedCode.trim().toUpperCase(),
    };
  }

  // spec-71 phase 3 review item 3 — the same ambiguity guard
  // `resolvePositionByScannedCode` enforces for load_positions: a scan
  // colliding with more than one active consolidación zone must fail
  // loudly, never resolve to an arbitrary one of them.
  if (outcome.kind === 'ambiguous') {
    return {
      kind: 'rejected',
      message: 'El código escaneado coincide con más de una zona activa. Avisa a un supervisor.',
      rejectedCode: input.scannedCode.trim().toUpperCase(),
    };
  }

  // For consolidación redirect, switch the batch's zone first so the trigger
  // routes the package to retenido/consolidación instead of sectorizado.
  if (outcome.kind === 'accepted_consolidation') {
    await updateBatchDockZone({
      batchId: input.currentBatchId,
      zoneId: outcome.zoneId,
      operatorId: input.operatorId,
    });
  }

  if (input.packageLabel) {
    try {
      await input.scanMutateAsync({
        barcode: input.packageLabel,
        ...(outcome.kind === 'accepted_consolidation'
          ? { redirectReason: 'manual_consolidation' as const }
          : {}),
      });
    } catch {
      // scan mutation failure should not block the flow
    }
  }

  input.closeBatchMutate({ id: input.currentBatchId, operator_id: input.operatorId });

  return { kind: 'accepted', zoneCode: input.destination.zone_code, zoneName: input.destination.zone_name };
}
