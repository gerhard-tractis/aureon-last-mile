/**
 * spec-54 — package counts for the stage rail.
 *
 * get_ops_control_snapshot returns a `packages` array on every order and
 * manifest, so no endpoint change is needed to show packages alongside orders.
 * Routes carry none, which is why this returns null rather than 0 for the
 * route-based stages: 0 would claim the stage is empty, null says we have no
 * package data and the card hides the line.
 *
 * Counts package *rows*, one per manifest line — the same unit
 * get_pre_route_snapshot reports as package_count. Physical boxes are a
 * different number (packages.declared_box_count, see spec-53/55) and are not
 * what "paquetes" means elsewhere in the product.
 */
export function countPackages(items: Record<string, unknown>[]): number | null {
  let total = 0;
  let sawPackages = false;

  for (const item of items) {
    const packages = item['packages'];
    if (!Array.isArray(packages)) continue;
    sawPackages = true;
    total += packages.length;
  }

  return sawPackages ? total : null;
}
