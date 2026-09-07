/**
 * The pickup leg of the bitácora. `audit_logs` records *that* an order
 * became `verificado`, but not on whose route — order audit rows carry no
 * route reference at all. The verification itself is a `pickup_scans` row,
 * and that row does know: `pickup_scans.manifest_id` → `manifests` →
 * `manifests.pickup_route_id` → `pickup_routes.code`.
 *
 * Confirmed on Musan QA for CARGA-EASY-001-ORD-09: four `verified` scans by
 * "Musan Líder de Recogida" on route `PR-2026-2298`, at 17:11:40/47/57/59 —
 * interleaved with the very audit rows that show the order reaching
 * `verificado` at 17:11:58. The route was always there; the earlier hotfix
 * looked at `reception_scans` (the hub-reception table) and wrongly
 * concluded no route existed.
 */
export type PickupScanResult = 'verified' | 'not_found' | 'duplicate';

export type DossierPickupScan = {
  id: string;
  scanned_at: string | null;
  /** Widened past the enum on purpose: a new DB value must still render. */
  scan_result: PickupScanResult | string;
  barcode_scanned: string;
  package_id: string | null;
  scanned_by_user_id: string | null;
  /** `pickup_routes.id`, resolved through the scan's manifest. */
  route_id: string | null;
  /** `pickup_routes.code` — the operator-facing route name (`PR-2026-2298`). */
  route_code: string | null;
  /** Resolved display name for `scanned_by_user_id`; see `audit-actors`. */
  actorName?: string | null;
};

export interface DecodedPickupScan {
  title: string;
  /** The package as the operator knows it, or the raw barcode if unknown. */
  packageLabel: string;
}

const SCAN_RESULT_TITLES: Record<string, string> = {
  verified: 'Paquete verificado en recogida',
  duplicate: 'Escaneo duplicado en recogida',
  not_found: 'Código no reconocido en recogida',
};

export function decodePickupScan(
  scan: DossierPickupScan,
  packageLabels: Record<string, string> = {},
): DecodedPickupScan {
  const label = scan.package_id ? packageLabels[scan.package_id] : undefined;
  return {
    title: SCAN_RESULT_TITLES[scan.scan_result] ?? 'Escaneo de recogida',
    // A `not_found` scan has no package by definition, so the barcode the
    // scanner actually read is the only identifier the row carries.
    packageLabel: label ?? scan.barcode_scanned,
  };
}

/**
 * What to print in the route chip. The code is what an operator recognises;
 * the uuid is the honest fallback when a route exists but has no code yet.
 * null means the scan genuinely has no route — omit the chip, don't invent.
 */
export function pickupScanRouteLabel(scan: DossierPickupScan): string | null {
  return scan.route_code ?? scan.route_id ?? null;
}
