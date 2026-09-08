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
}

export interface ReviewCounts {
  verifiedCount: number;
  missingCount: number;
  unexpectedCount: number;
  totalCount: number;
}

/**
 * Distinct not_found barcodes, not a row count — the same H3 dedupe rule
 * close_manifest applies server-side. A crew retrying a rejected foreign
 * barcode inserts one pickup_scans row per attempt; counting rows would
 * multiply one foreign package into several.
 */
export function dedupeNotFoundBarcodes(scans: ReviewScan[]): string[] {
  const seen = new Set<string>();
  for (const scan of scans) {
    if (scan.scan_result === 'not_found' && scan.barcode_scanned) {
      seen.add(scan.barcode_scanned);
    }
  }
  return Array.from(seen);
}

export function computeReviewCounts(
  scans: ReviewScan[],
  missingCount: number
): ReviewCounts {
  const verifiedCount = scans.filter((s) => s.scan_result === 'verified').length;
  const unexpectedCount = dedupeNotFoundBarcodes(scans).length;
  return {
    verifiedCount,
    missingCount,
    unexpectedCount,
    totalCount: verifiedCount + missingCount,
  };
}

/**
 * `5e`'s gate: every declared-and-unverified package must carry a note
 * before the crew can move on to `5f` — the client signs over that note.
 * Vacuously true with zero missing packages, which is also what lets the
 * screen "pasa directo a 5f" per the spec.
 */
export function allMissingNotesComplete(
  missingPackageIds: string[],
  noteMap: Map<string, string>
): boolean {
  return missingPackageIds.every((id) => {
    const note = noteMap.get(id);
    return !!note && note.trim().length > 0;
  });
}

export function closeButtonLabel(missingCount: number): string {
  if (missingCount === 0) return 'Continuar a firma';
  return `Cerrar con ${missingCount} faltante${missingCount === 1 ? '' : 's'}`;
}
