/**
 * Ops Control stage derivation.
 *
 * Ops Control used to key every stage off `orders.status` alone. That loses the
 * two milestones the Distribución module produces: `trg_dock_scan_advance_package_status`
 * (latest def 20260506000001) writes `packages.status = 'sectorizado'` for a normal
 * dock zone and `'retenido'` for a zone with `is_consolidation = true`, and
 * `recalculate_order_status` (latest def 20260810000001) deliberately collapses
 * both back to the order status `en_bodega` — positions 4 and 5 are documented
 * there as package-only states.
 *
 * So an order whose packages had just been distributed to an andén stayed
 * counted in Recepción, and Consolidación could never hold anything at all.
 * The package rows are already in the snapshot (`get_ops_control_snapshot`
 * returns each order's `packages[]` with their status), so the stage is derived
 * here instead — by MIN pipeline position, the same roll-up rule the database
 * uses, which is why an order with one package still in bodega stays in
 * Recepción until the whole order has been scanned across.
 */

/** Mirror of the SQL `pipeline_position()` (latest def 20260810000001). */
const PACKAGE_PIPELINE_POSITION: Record<string, number> = {
  ingresado: 1,
  verificado: 2,
  en_bodega: 3,
  sectorizado: 4,
  retenido: 5,
  asignado: 6,
  en_carga: 7,
  listo_para_despacho: 8,
  en_ruta: 9,
  entregado: 10,
};

/**
 * The two package-only positions, and the stage each one belongs to. Everything
 * else is already represented by the order status, so it falls through.
 */
const PACKAGE_ONLY_STAGE: Record<number, string> = {
  4: 'docks',          // sectorizado — staged at a delivery andén
  5: 'consolidation',  // retenido — held in a consolidation zone
};

/** Map order status → ops-control stage key. */
function statusStage(status: unknown): string | null {
  switch (status) {
    case 'en_bodega':            return 'reception';
    case 'asignado':
    case 'en_carga':
    case 'listo_para_despacho':  return 'docks';
    case 'en_ruta':              return 'delivery';
    default:                     return null;
  }
}

/** Lowest active pipeline position across an order's packages, or null. */
function minPackagePosition(packages: unknown): number | null {
  if (!Array.isArray(packages)) return null;

  let min: number | null = null;
  for (const p of packages) {
    const status = (p as Record<string, unknown> | null)?.['status'];
    // Terminal statuses (cancelado, devuelto, dañado, extraviado, retorno_hub)
    // are absent from the map and skipped — same as the SQL roll-up, which
    // filters on pipeline_position(status) > 0.
    const position = PACKAGE_PIPELINE_POSITION[status as string];
    if (position === undefined) continue;
    if (min === null || position < min) min = position;
  }
  return min;
}

/**
 * Stage for a snapshot order row. Package positions win only where the order
 * status cannot express them (andén / consolidación); otherwise the order
 * status decides, so route-side stages are untouched.
 */
export function deriveOrderStage(order: Record<string, unknown>): string | null {
  const min = minPackagePosition(order['packages']);
  if (min !== null && PACKAGE_ONLY_STAGE[min]) return PACKAGE_ONLY_STAGE[min];
  return statusStage(order['status']);
}

/** Map route status → ops-control stage key. */
export function deriveRouteStage(status: unknown): string | null {
  switch (status) {
    case 'draft':
    case 'planned':      return 'docks';
    case 'in_progress':  return 'delivery';
    default:             return null;
  }
}
