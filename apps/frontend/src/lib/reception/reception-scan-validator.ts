import { createSPAClient } from '@/lib/supabase/client';

export type ReceptionScanResult =
  | 'received'
  | 'not_found'
  | 'duplicate'
  | 'route_mismatch';

export interface ReceptionScanValidationResult {
  scanResult: ReceptionScanResult;
  packageId: string | null;
  packageLabel: string | null;
  message?: string;
  /**
   * ADVISORY ONLY. True when the package is on this route's manifests but has
   * no `verified` pickup scan (discriminator row 7). The authoritative
   * `unexpected_count` is derived server-side by
   * `trg_reception_scans_route_received_count`; never write this value back to
   * the database. It exists so the UI can hint at the outcome immediately.
   */
  unexpected?: boolean;
}

interface ValidateReceptionScanInput {
  barcode: string;
  receptionId: string;
  /** The `pickup_routes.id` being received. Membership is scoped to it. */
  routeId: string;
  operatorId: string;
}

/** Statuses that mean the package has already been received or gone further */
const ALREADY_RECEIVED_STATUSES = [
  'en_bodega', 'sectorizado', 'retenido', 'asignado', 'en_carga',
  'listo_para_despacho',
  'en_ruta', 'entregado', 'cancelado', 'devuelto',
  'dañado', 'extraviado',
];

/**
 * Route-scoped reception scan discriminator (spec-52).
 *
 * Rows 1 and 2 keep TODAY'S evaluation order — duplicate is checked before
 * not-found, so a re-scanned unknown barcode still reads as `duplicate`. The
 * discriminator table is a rule list, not an execution sequence for those two.
 *
 * Route membership here is **manifest-derived**:
 *
 *   packages.order_id → orders
 *   orders.external_load_id = manifests.external_load_id
 *     AND orders.operator_id = manifests.operator_id   -- REQUIRED, see below
 *   manifests.pickup_route_id = :routeId
 *
 * There is no foreign key from `orders` to `manifests`; this is a soft string
 * match on a nullable column. `manifests.external_load_id` is unique only as
 * `UNIQUE(operator_id, external_load_id)`, so the `operator_id` predicate is
 * load-bearing — without it another tenant's carga with the same
 * `external_load_id` can be read as membership of this route.
 *
 * COEXISTENCE: `get_route_reception_snapshot` derives its *expected* package
 * set from pickup scans, while this validator derives *membership* from
 * manifests. The two definitions can legitimately disagree — a package on a
 * route's manifest that was never pickup-scanned is a member but not expected.
 * That is row 7, and it is intentional. Do not assume the two are
 * interchangeable.
 */
export async function validateReceptionScan(
  input: ValidateReceptionScanInput
): Promise<ReceptionScanValidationResult> {
  const { barcode, receptionId, routeId, operatorId } = input;
  const supabase = createSPAClient();

  // Row 2 — already scanned in this batch. Evaluated first, see note above.
  const { data: existing } = await supabase
    .from('reception_scans')
    .select('id')
    .eq('reception_id', receptionId)
    .eq('barcode', barcode)
    .eq('scan_result', 'received')
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return { scanResult: 'duplicate', packageId: null, packageLabel: barcode };
  }

  // Row 1 — label matches no package for this operator.
  const { data: packageMatch } = await supabase
    .from('packages')
    .select('id, label, status, order_id')
    .eq('operator_id', operatorId)
    .eq('label', barcode)
    .is('deleted_at', null)
    .limit(1);

  if (!packageMatch || packageMatch.length === 0) {
    return {
      scanResult: 'not_found',
      packageId: null,
      packageLabel: null,
      message: 'Paquete no pertenece a esta carga',
    };
  }

  const pkg = packageMatch[0];

  // Row 3 — no computable route membership (`orders.external_load_id` is
  // nullable). Accepting it would attribute the package to a route it may not
  // belong to and corrupt the count.
  const externalLoadId = pkg.order_id
    ? await fetchExternalLoadId(supabase, pkg.order_id, operatorId)
    : null;

  if (!externalLoadId) {
    return {
      scanResult: 'not_found',
      packageId: null,
      packageLabel: pkg.label,
      message: 'Paquete sin carga asociada',
    };
  }

  // Row 4 — already received on a prior route, or terminal. This is an
  // explicit 12-value list, NOT an ordinal range: `cancelado`, `devuelto`,
  // `dañado` and `extraviado` are rank 0 under `pipeline_position` and are
  // therefore not "beyond en_bodega". Reference the constant; do not re-derive.
  if (ALREADY_RECEIVED_STATUSES.includes(pkg.status)) {
    return {
      scanResult: 'not_found',
      packageId: null,
      packageLabel: pkg.label,
      message: 'Paquete ya fue recibido en bodega',
    };
  }

  // Row 5 — membership resolution.
  const { data: manifestMatches } = await supabase
    .from('manifests')
    .select('id, pickup_route_id')
    .eq('operator_id', operatorId)
    .eq('external_load_id', externalLoadId)
    .is('deleted_at', null)
    .limit(50);

  const manifests = manifestMatches ?? [];
  const onThisRoute = manifests.some((m) => m.pickup_route_id === routeId);

  if (!onThisRoute) {
    if (manifests.length === 0) {
      // The carga exists on the order but no manifest carries it — membership
      // is still not computable, so this is row 3, not a wrong truck.
      return {
        scanResult: 'not_found',
        packageId: null,
        packageLabel: pkg.label,
        message: 'Paquete sin carga asociada',
      };
    }
    return {
      scanResult: 'route_mismatch',
      packageId: pkg.id,
      packageLabel: pkg.label,
      message: 'Paquete no pertenece a este camión',
    };
  }

  // Rows 6 and 7 — on this route. Present either way; the only difference is
  // whether the driver ever scanned it at pickup.
  const { data: pickupScans } = await supabase
    .from('pickup_scans')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('package_id', pkg.id)
    .eq('scan_result', 'verified')
    .is('deleted_at', null)
    .limit(1);

  return {
    scanResult: 'received',
    packageId: pkg.id,
    packageLabel: pkg.label,
    unexpected: !(pickupScans && pickupScans.length > 0),
  };
}

async function fetchExternalLoadId(
  supabase: ReturnType<typeof createSPAClient>,
  orderId: string,
  operatorId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('orders')
    .select('id, external_load_id')
    .eq('operator_id', operatorId)
    .eq('id', orderId)
    .is('deleted_at', null)
    .limit(1);

  return data?.[0]?.external_load_id ?? null;
}
