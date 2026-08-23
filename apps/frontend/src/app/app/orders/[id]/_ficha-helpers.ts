/**
 * spec-65 Task 9 — pure helpers for `3b`, the order ficha page.
 *
 * These are deliberately NOT shared with `1f` (`OrderInspector`), which
 * keeps its own private `deliveryDispatch`. Both pick the same row for the
 * same reason (a retried delivery leaves more than one non-pickup dispatch
 * row, and `useOrderDossier` already orders them newest-completed-first,
 * `id` DESC as a tiebreak — see that hook's own comment), so this helper
 * only filters by `is_pickup`, never re-sorts.
 */

import type { DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * Note: the Todo/Aureon/DispatchTrack source filter used to live here as
 * `filterAuditLogsBySource`/`filterDispatchesBySource`, applied by
 * `FichaCenterColumn` to `UnifiedEventLog`'s inputs from the outside.
 * Controller-authorized extension (round 2) moved that filtering INSIDE
 * `UnifiedEventLog` itself, via its own `sourceFilter` prop — only that
 * component can distinguish "no courier events exist" from "courier
 * events exist but are hidden by the current filter", which filtering the
 * inputs before they arrived could not. See `UnifiedEventLog.tsx` and
 * `FichaCenterColumn.tsx`.
 */

/**
 * The breadcrumb's own return path. `3b` is reached with whatever query
 * string the list view (`3a`) had at the time — this hands it back
 * unmodified so "Pedidos" returns to the view the user left, not the
 * preset default. Never inspects or reshapes the string.
 */
export function breadcrumbHref(queryString: string): string {
  return queryString ? `/app/orders?${queryString}` : '/app/orders';
}

function dispatchOccurredAt(d: DossierDispatch): string | null {
  return d.completed_at ?? d.arrived_at ?? d.estimated_at ?? null;
}

/**
 * "Último webhook" in ORIGEN DE LOS DATOS — the newest courier timestamp
 * across every dispatch leg (pickup and delivery), not just the delivery
 * attempt. Null when there are no dispatches, or none carry a timestamp
 * yet (a dispatch row can exist with only `status`/`substatus` set).
 */
export function lastWebhookTimestamp(dispatches: DossierDispatch[]): string | null {
  let latest: string | null = null;
  for (const d of dispatches) {
    const ts = dispatchOccurredAt(d);
    if (ts && (!latest || ts > latest)) latest = ts;
  }
  return latest;
}

/** The order's delivery attempt (as opposed to a pickup leg) — null when there is none. */
export function deliveryDispatch(dispatches: DossierDispatch[]): DossierDispatch | null {
  return dispatches.find((d) => !d.is_pickup) ?? null;
}
