import { ScanResult } from '@/components/scan/ScanResult';
import { timeLabel } from '@/lib/reception/reception-mobile-helpers';
import type { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';

/**
 * spec-62 chunk 3 — the persistent result block of the mobile unloading
 * screen (mock 3q). An operator scans box after box without confirming each
 * one; this block is the only feedback they get, and it must stay on screen
 * until the *next* scan — an operator who looks away mid-read must be able
 * to look back and still see where the last box went.
 *
 * Pure presentation: it translates `ReceptionScanValidationResult` into
 * `ScanResult` props. No lookups, no data fetching, no timers. `firstScanAt`
 * for the `duplicate` case is supplied by the caller (Task 18) — this
 * component does not search history for it, deliberately: after the mutation
 * invalidates the snapshot, a naive search for a row with this barcode can
 * find the duplicate scan itself and report its own time as "first".
 */
export interface ReceptionScanFeedbackProps {
  /** The latest read, or null before the first scan of the session. */
  result: ReceptionScanValidationResult | null;
  /** `received_count` after that read, for the large counter. */
  receivedCount: number;
  /** When the same barcode was first scanned, if the caller has it. */
  firstScanAt?: string | null;
}

export function ReceptionScanFeedback({
  result,
  receivedCount,
  firstScanAt,
}: ReceptionScanFeedbackProps) {
  if (result === null) return null;

  const context = result.packageLabel ?? undefined;

  // received + unexpected is deliberately its own row, not a variant of
  // plain `received`: the box is counted either way, but "ajeno" (no
  // verified pickup on this route) needs its own colour AND shape so an
  // operator scanning continuously can tell it apart at a glance.
  if (result.scanResult === 'received' && result.unexpected) {
    return (
      <ScanResult
        status="warn"
        title="AJENO — RECIBIDO"
        context={context}
        code={String(receivedCount)}
      />
    );
  }

  // `code` is shown only on the two outcomes that genuinely move
  // `received_count` (spec-52). `ScanResult` itself documents `code` as
  // "omitted on error" — honouring that contract, not a UX opinion of ours:
  // at 34px it is the loudest element in the block, so showing an unchanged
  // number on duplicate/not_found/route_mismatch would read as a second
  // increment rather than as "this one didn't count".
  if (result.scanResult === 'received') {
    return (
      <ScanResult
        status="ok"
        title="RECIBIDO"
        context={context}
        code={String(receivedCount)}
      />
    );
  }

  if (result.scanResult === 'duplicate') {
    return (
      <ScanResult
        status="warn"
        title="YA ESCANEADO"
        context={context}
        timestamp={timeLabel(firstScanAt ?? null) ?? undefined}
      />
    );
  }

  if (result.scanResult === 'not_found') {
    return <ScanResult status="error" title="NO ESTÁ EN LA RUTA" context={context} />;
  }

  // route_mismatch
  return <ScanResult status="error" title="ES DE OTRA RUTA" context={context} />;
}
