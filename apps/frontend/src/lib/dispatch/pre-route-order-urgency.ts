import type { UnroutedOrderRow } from '@/hooks/dispatch/pre-route/useUnroutedGroups';

/**
 * spec-75 task 2b — sorting and urgency for the delivery-window column in
 * "Órdenes sin rutear". Split out of useUnroutedGroups.ts purely to keep
 * both files (and their test files) under the 300-line cap; the hook still
 * re-exports these for `UnroutedColumn`'s existing import path.
 */

/**
 * Ascending sort by window END, orders with no window pushed to the end.
 * Used by the "Ordenar por ventana" toggle in UnroutedColumn — sorts each
 * group's rows independently, it never reorders across groups.
 *
 * Code-review finding (I7): this used to sort by windowStart while
 * `urgentOrderIds` flagged by windowEnd, so the row the toggle moved to the
 * top wasn't the row the chip turned red — two different axes presented as
 * one "ventana" control. Both now read windowEnd: a closing window is the
 * constraint that matters for planning (an order starting late but closing
 * late too isn't urgent; one closing soon is, however late it started).
 */
export function sortOrdersByWindow(orders: UnroutedOrderRow[]): UnroutedOrderRow[] {
  return [...orders].sort((a, b) => {
    if (a.windowEnd === b.windowEnd) return 0;
    if (a.windowEnd === null) return 1;
    if (b.windowEnd === null) return -1;
    return a.windowEnd.localeCompare(b.windowEnd);
  });
}

/** Orders within this many minutes of the earliest closing window still count as urgent. */
const URGENT_WINDOW_MINUTES = 60;

function toMinutesSinceMidnight(hms: string): number {
  const [h, m] = hms.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Order ids whose delivery window closes within `URGENT_WINDOW_MINUTES` of
 * the earliest closing time among the given rows — the set
 * UnroutedOrderRow renders its urgency chip red for. Computed across every
 * visible row (all groups), not per group, so an order isn't "urgent" only
 * relative to its own comuna/andén. Orders with no windowEnd are never
 * urgent — there's nothing to close "sooner" on.
 *
 * Code-review finding: an exact-minimum tie is a degenerate definition —
 * it flags exactly one row normally, but *every* row sharing the minimum
 * (e.g. 80 orders all closing at 12:00:00 from a bulk import) at once, and
 * nothing else, even an order closing one minute later. A band around the
 * minimum is what "sooner than others" actually means.
 */
export function urgentOrderIds(orders: UnroutedOrderRow[]): Set<string> {
  const ends = orders.map((o) => o.windowEnd).filter((e): e is string => e !== null);
  if (ends.length === 0) return new Set();
  const earliestMinutes = Math.min(...ends.map(toMinutesSinceMidnight));
  return new Set(
    orders
      .filter(
        (o) => o.windowEnd !== null && toMinutesSinceMidnight(o.windowEnd) - earliestMinutes <= URGENT_WINDOW_MINUTES,
      )
      .map((o) => o.id),
  );
}
