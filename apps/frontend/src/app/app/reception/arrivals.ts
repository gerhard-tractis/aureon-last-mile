import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';
import { minutesSince, timeLabel } from '@/lib/reception/reception-mobile-helpers';

// Re-exported so existing importers of this constant from `arrivals.ts` keep
// working; the definition now lives in `lib/reception/reception-mobile-helpers.ts`
// to respect the `app→components→hooks→lib→Supabase` layering rule.
export { YARD_WAIT_WARNING_MINUTES } from '@/lib/reception/reception-mobile-helpers';

/**
 * spec-54 phase 4.6 — "Llegadas de hoy" (mock 3c).
 *
 * One list out of the three lifecycle queries the reception landing already
 * runs, so the receptionist reads arrivals as a single sequence rather than
 * hunting across tabs.
 */

export type ArrivalState = 'yard' | 'transit' | 'closed';

export interface ArrivalRow {
  id: string;
  code: string;
  driverName: string | null;
  manifestCount: number;
  expectedPackages: number;
  state: ArrivalState;
  /** Minutes since the truck reached the yard. null when it has not arrived. */
  waitingMinutes: number | null;
  arrivedAtLabel: string | null;
}

export const ARRIVAL_STATE_LABEL: Record<ArrivalState, string> = {
  yard: 'EN PATIO',
  transit: 'EN TRÁNSITO',
  closed: 'CERRADA',
};


function toRow(route: IncomingRoute, state: ArrivalState, now: Date): ArrivalRow {
  return {
    id: route.id,
    code: route.code,
    driverName: route.driver_name,
    manifestCount: route.manifest_count ?? 0,
    expectedPackages: route.expected_packages ?? 0,
    state,
    // Only a truck in the yard is "waiting"; one still driving is not late to
    // a counter that has not started.
    waitingMinutes: state === 'yard' ? minutesSince(route.in_transit_at, now) : null,
    arrivedAtLabel: state === 'yard' ? timeLabel(route.in_transit_at) : null,
  };
}

/**
 * Yard first, longest wait first — the truck blocking a bay is the one the
 * receptionist has to deal with, regardless of when it was scheduled.
 */
export function buildArrivals(
  input: { yard: IncomingRoute[]; transit: IncomingRoute[]; closed: IncomingRoute[] },
  now: Date = new Date(),
): ArrivalRow[] {
  const rows = [
    ...input.yard.map((r) => toRow(r, 'yard', now)),
    ...input.transit.map((r) => toRow(r, 'transit', now)),
    ...input.closed.map((r) => toRow(r, 'closed', now)),
  ];

  const order: Record<ArrivalState, number> = { yard: 0, transit: 1, closed: 2 };
  return rows.sort(
    (a, b) =>
      order[a.state] - order[b.state] || (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0),
  );
}

export interface ArrivalTotals {
  expectedRoutes: number;
  expectedPackages: number;
  yardRoutes: number;
  longestYardWait: number | null;
  closedRoutes: number;
  closedPackages: number;
}

export function arrivalTotals(rows: ArrivalRow[]): ArrivalTotals {
  const yard = rows.filter((r) => r.state === 'yard');
  const closed = rows.filter((r) => r.state === 'closed');
  const open = rows.filter((r) => r.state !== 'closed');

  return {
    expectedRoutes: open.length,
    expectedPackages: open.reduce((s, r) => s + r.expectedPackages, 0),
    yardRoutes: yard.length,
    longestYardWait: yard.length
      ? Math.max(...yard.map((r) => r.waitingMinutes ?? 0))
      : null,
    closedRoutes: closed.length,
    closedPackages: closed.reduce((s, r) => s + r.expectedPackages, 0),
  };
}
