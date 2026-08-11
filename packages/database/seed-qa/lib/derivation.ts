/**
 * spec-51 — an independent model of how orders.status is derived.
 *
 * This is deliberately a SECOND implementation of the rules in
 * recalculate_order_status (latest definition 20260810000001). The matrix
 * scenario seeds every combination of package statuses and asserts the database
 * agrees with this model. When they disagree, one of them is wrong — and that
 * is exactly the signal we want, because a single implementation can only ever
 * confirm itself.
 *
 * Written from the SQL, not from the same source as the SQL, so it does not
 * inherit its mistakes. The listo -> listo_para_despacho rename broke the SQL
 * for five months without anything noticing.
 */

/** pipeline_position(), latest definition 20260319000001 + 20260810000001. */
const PIPELINE_POSITION: Record<string, number> = {
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

/** Everything else — retorno_hub, cancelado, devuelto, dañado, extraviado. */
export function pipelinePosition(status: string): number {
  return PIPELINE_POSITION[status] ?? 0;
}

/** Positions 4 and 5 (sectorizado, retenido) collapse to en_bodega. */
function statusForPosition(position: number): string {
  if (position <= 3) {
    return ['', 'ingresado', 'verificado', 'en_bodega'][position];
  }
  if (position === 4 || position === 5) return 'en_bodega';
  return (
    { 6: 'asignado', 7: 'en_carga', 8: 'listo_para_despacho', 9: 'en_ruta', 10: 'entregado' }[
      position
    ] ?? ''
  );
}

export interface DerivedOrderStatus {
  status: string;
  leadingStatus: string;
}

/**
 * Predict orders.status / orders.leading_status for a set of package statuses.
 *
 * Returns null when the combination cannot occur — an order with no live
 * packages at all, which the trigger never sees because it fires from a package
 * row.
 */
export function deriveOrderStatus(packageStatuses: string[]): DerivedOrderStatus | null {
  if (packageStatuses.length === 0) return null;

  const activeCount = packageStatuses.filter((s) => pipelinePosition(s) > 0).length;
  const retornoCount = packageStatuses.filter((s) => s === 'retorno_hub').length;
  const entregadoCount = packageStatuses.filter((s) => s === 'entregado').length;

  // Rule 1 & 2 — any return short-circuits everything below.
  if (retornoCount > 0) {
    const result = entregadoCount > 0 ? 'parcialmente_entregado' : 'en_retorno';
    return { status: result, leadingStatus: result };
  }

  // Rule 3 — nothing live and nothing delivered.
  if (activeCount + entregadoCount === 0) {
    return { status: 'cancelado', leadingStatus: 'cancelado' };
  }

  // Rule 4 — min position drives status, max drives leading_status. Terminal
  // packages (position 0) are excluded from both.
  const positions = packageStatuses.map(pipelinePosition).filter((p) => p > 0);
  return {
    status: statusForPosition(Math.min(...positions)),
    leadingStatus: statusForPosition(Math.max(...positions)),
  };
}

/** package_status_enum, verified against pg_enum on the QA database. */
export const PACKAGE_STATUSES = [
  'ingresado',
  'verificado',
  'en_bodega',
  'sectorizado',
  'retenido',
  'asignado',
  'en_carga',
  'listo_para_despacho',
  'en_ruta',
  'retorno_hub',
  'entregado',
  'cancelado',
  'devuelto',
  'dañado',
  'extraviado',
] as const;

/**
 * Every multiset of package statuses of the given size, order-insensitive —
 * [a,b] and [b,a] produce the same order status, so testing both is waste.
 */
export function combinationsOfSize(size: number): string[][] {
  if (size <= 0) return [];
  if (size === 1) return PACKAGE_STATUSES.map((s) => [s]);

  const result: string[][] = [];
  const build = (start: number, current: string[]): void => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < PACKAGE_STATUSES.length; i++) {
      current.push(PACKAGE_STATUSES[i]);
      build(i, current);
      current.pop();
    }
  };
  build(0, []);
  return result;
}

/**
 * Three-package combinations worth testing. The full set is 680 and almost all
 * add no new derivation path — the rules only look at min, max, and whether
 * retorno_hub / entregado are present. These are the ones that do something a
 * smaller combination cannot: a return plus a delivery plus a live package.
 */
export function targetedTripleCombinations(): string[][] {
  const live = ['ingresado', 'en_bodega', 'en_carga', 'listo_para_despacho', 'en_ruta'];
  const triples: string[][] = [];

  for (const active of live) {
    triples.push(['retorno_hub', 'entregado', active]); // partial + still moving
    triples.push(['retorno_hub', active, active]); // return dominates actives
    triples.push(['entregado', active, 'cancelado']); // terminal ignored in min/max
  }
  triples.push(['dañado', 'extraviado', 'devuelto']); // all terminal -> cancelado
  triples.push(['entregado', 'entregado', 'entregado']);
  triples.push(['retorno_hub', 'retorno_hub', 'entregado']);

  return triples;
}
