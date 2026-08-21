import { ScanResult } from '@/components/scan/ScanResult';
import { timeLabel } from '@/lib/reception/reception-mobile-helpers';
import type { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';

/**
 * spec-62 chunk 3 — the persistent result block of the mobile unloading
 * screen (mock 3q). An operator scans box after box without confirming each
 * one; this block is the only feedback they get, and it must stay on screen
 * until the *next* scan (Task 19 removes the 3s auto-hide that used to sit
 * here) — otherwise there is no way to tell, a beat later, whether the last
 * box registered.
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
  // The running total is always shown, counted-outcome or not: the operator
  // needs to see it hasn't moved on a duplicate/error just as much as they
  // need to see it has on a receive.
  const code = String(receivedCount);

  // received + unexpected is deliberately its own row, not a variant of
  // plain `received`: the box is counted either way, but "ajeno" (no
  // verified pickup on this route) needs its own colour AND shape so an
  // operator scanning continuously can tell it apart at a glance.
  if (result.scanResult === 'received' && result.unexpected) {
    return <ScanResult status="warn" title="AJENO — RECIBIDO" context={context} code={code} />;
  }

  if (result.scanResult === 'received') {
    return <ScanResult status="ok" title="RECIBIDO" context={context} code={code} />;
  }

  if (result.scanResult === 'duplicate') {
    return (
      <ScanResult
        status="warn"
        title="YA ESCANEADO"
        context={context}
        code={code}
        timestamp={timeLabel(firstScanAt ?? null) ?? undefined}
      />
    );
  }

  if (result.scanResult === 'not_found') {
    return <ScanResult status="error" title="NO ESTÁ EN LA RUTA" context={context} code={code} />;
  }

  // route_mismatch
  return <ScanResult status="error" title="ES DE OTRA RUTA" context={context} code={code} />;
}
