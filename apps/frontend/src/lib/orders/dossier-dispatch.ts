/**
 * spec-65 — shared dossier-dispatch helpers.
 *
 * `deliveryDispatch` used to be duplicated byte-for-byte in
 * `[id]/_ficha-helpers.ts` (3b) and `inspector/OrderInspector.tsx` (1f),
 * each carrying a comment defending the duplication on the grounds that the
 * two pick the same row for the same reason (a retried delivery leaves more
 * than one non-pickup dispatch row, and `useOrderDossier` already orders
 * them newest-completed-first, `id` DESC as a tiebreak). They agreed today;
 * that was two places the next change to this rule would have had to find.
 * Extracted here (final review round) so there is exactly one.
 */

import type { DossierDispatch } from '@/hooks/useOrderDossier';

/** The order's delivery attempt (as opposed to a pickup leg) — null when there is none. */
export function deliveryDispatch(dispatches: DossierDispatch[]): DossierDispatch | null {
  return dispatches.find((d) => !d.is_pickup) ?? null;
}
