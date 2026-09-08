/**
 * spec-80 fase 2 — pure counting/gating logic for the `5e` review screen
 * (`app/app/pickup/review/[loadId]/page.tsx`).
 *
 * Kept out of the component/hook layer on purpose: these are the numbers the
 * client signs against on `5f` (close_manifest's out_verified_count /
 * out_missing_count / out_unexpected_count are the server-side twin of this
 * — see 20260913000004_spec80_close_manifest_acl_fix.sql), so getting the
 * dedupe rule wrong here is a discrepancy between what the crew sees and
 * what the RPC records.
 */

export interface ReviewScan {
  scan_result: string;
  barcode_scanned?: string | null;
  scanned_at?: string;
}

export interface ReviewCounts {
  verifiedCount: number;
  missingCount: number;
  unexpectedCount: number;
  totalCount: number;
}

export interface UnexpectedScan {
  barcode: string;
  scannedAt: string;
}

/**
 * Distinct not_found barcodes, not a row count — the same H3 dedupe rule
 * close_manifest applies server-side. A crew retrying a rejected foreign
 * barcode inserts one pickup_scans row per attempt; counting rows would
 * multiply one foreign package into several. Keeps the FIRST scanned_at
 * seen for each barcode — mock 5g shows "escaneado 08:47" per barcode, one
 * timestamp, not a list of retries.
 */
export function dedupeNotFoundScans(scans: ReviewScan[]): UnexpectedScan[] {
  const seen = new Map<string, string>();
  for (const scan of scans) {
    if (scan.scan_result === 'not_found' && scan.barcode_scanned) {
      if (!seen.has(scan.barcode_scanned)) {
        seen.set(scan.barcode_scanned, scan.scanned_at ?? '');
      }
    }
  }
  return Array.from(seen.entries()).map(([barcode, scannedAt]) => ({
    barcode,
    scannedAt,
  }));
}

export function computeReviewCounts(
  scans: ReviewScan[],
  missingCount: number
): ReviewCounts {
  const verifiedCount = scans.filter((s) => s.scan_result === 'verified').length;
  const unexpectedCount = dedupeNotFoundScans(scans).length;
  return {
    verifiedCount,
    missingCount,
    unexpectedCount,
    totalCount: verifiedCount + missingCount,
  };
}

/**
 * Label for the SECONDARY (red-outlined) CTA, only rendered while
 * missingCount > 0 — see primaryButtonLabel for the gold one.
 */
export function closeButtonLabel(missingCount: number): string {
  return `Cerrar con ${missingCount} faltante${missingCount === 1 ? '' : 's'}`;
}

/**
 * Mock `5e` makes "Seguir escaneando" the gold/primary CTA while there is
 * anything missing — closing over a gap is the secondary, red-outlined
 * action, not the encouraged one. Once nothing is missing the screen
 * "pasa directo a 5f": a single gold "Continuar a firma" replaces both.
 */
export function primaryButtonLabel(missingCount: number): string {
  return missingCount > 0 ? 'Seguir escaneando' : 'Continuar a firma';
}

/**
 * Heading inside the red warning card. Only meaningful for missingCount > 0
 * — the card itself does not render at 0 (UnverifiedPackagesBlock). Spanish
 * agreement: "Falta 1 paquete" (singular verb+noun), "Faltan N paquetes".
 */
export function missingHeadingLabel(missingCount: number): string {
  if (missingCount === 1) return 'Falta 1 paquete';
  return `Faltan ${missingCount} paquetes`;
}

/**
 * Medio 5a (spec-80 fase 2 review, PR #686): mock `5e` draws "Falabella ·
 * Mall Plaza Vespucio" under CARGA-99814 — retailer + pickup point, from
 * manifests.retailer_name / manifests.pickup_location. pickup_location can
 * be NULL this early in the flow (populated at digitalization, spec-53/
 * spec-83), so this degrades gracefully instead of showing a bare "·".
 */
export function manifestSubtitleLabel(
  retailerName: string | null,
  pickupLocation: string | null
): string | null {
  if (retailerName && pickupLocation) return `${retailerName} · ${pickupLocation}`;
  return retailerName ?? pickupLocation ?? null;
}
