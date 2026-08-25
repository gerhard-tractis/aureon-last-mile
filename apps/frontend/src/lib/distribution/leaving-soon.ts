// apps/frontend/src/lib/distribution/leaving-soon.ts
//
// spec-68 Fase 2, Decisión 9 — `4c`'s "SALEN YA" KPI is derivable without a
// new column or hook: a package sitting in consolidación whose order is due
// today or tomorrow. `useConsolidation` already selects `delivery_date`, so
// this is pure arithmetic over data the screen already has.
//
// Reuses `formatRelativeDeliveryDate`'s tone ('urgent' = hoy, 'soon' =
// mañana) rather than re-deriving day offsets here — one place decides what
// "today" and "tomorrow" mean for a delivery date in this module.

import { formatRelativeDeliveryDate } from './relative-date';

export interface LeavingSoonPackage {
  delivery_date: string | null;
}

/**
 * True when `deliveryISO` is today or tomorrow relative to `todayISO`.
 * A missing date (null or empty string) is never "leaving soon" — there is
 * nothing to derive urgency from.
 */
export function isLeavingSoon(deliveryISO: string | null, todayISO: string): boolean {
  if (!deliveryISO) return false;
  const { tone } = formatRelativeDeliveryDate(deliveryISO, todayISO);
  return tone === 'urgent' || tone === 'soon';
}

export function countLeavingSoon(packages: LeavingSoonPackage[], todayISO: string): number {
  return packages.filter((p) => isLeavingSoon(p.delivery_date, todayISO)).length;
}
