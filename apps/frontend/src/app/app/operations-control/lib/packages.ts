import type { StageKey } from './labels.es';

/**
 * spec-54 — package counts for the stage rail.
 *
 * get_ops_control_snapshot returns a `packages` array on every order,
 * manifest and return, so no endpoint change is needed to show packages
 * alongside orders. Routes carry none.
 *
 * Counts package *rows*, one per manifest line — the same unit
 * get_pre_route_snapshot reports as package_count. Physical boxes are a
 * different number (packages.declared_box_count, see spec-53/55) and are not
 * what "paquetes" means elsewhere in the product.
 */

/**
 * Stages whose items carry packages. Deciding by stage rather than by
 * sampling the items matters when a stage is *empty*: with nothing to sample,
 * "does this stage have package data?" and "does this stage have anything at
 * all?" look identical, and an empty Recogida would hide its line instead of
 * saying `0 paquetes`.
 *
 * `delivery` is routes-only, which the snapshot returns without packages.
 * `reverse` is always empty by construction.
 */
const STAGES_WITH_PACKAGE_DATA: ReadonlySet<StageKey> = new Set<StageKey>([
  'pickup',
  'reception',
  'consolidation',
  'docks',
  'returns',
]);

/** Sum of package rows across items. Items without packages contribute zero. */
export function countPackages(items: Record<string, unknown>[]): number {
  let total = 0;
  for (const item of items) {
    const packages = item['packages'];
    if (Array.isArray(packages)) total += packages.length;
  }
  return total;
}

/**
 * Package count for a stage card, or null when the stage has no package data
 * to report — in which case the card hides the line rather than claiming zero.
 */
export function stagePackageCount(
  key: StageKey,
  items: Record<string, unknown>[],
): number | null {
  if (!STAGES_WITH_PACKAGE_DATA.has(key)) return null;
  return countPackages(items);
}
