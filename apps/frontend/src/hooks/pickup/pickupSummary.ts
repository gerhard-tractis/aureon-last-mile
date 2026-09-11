import type { CompletedManifest, InTransitManifest, PendingManifest } from './useManifests';
import type { RoutedManifest } from './useRoutedManifests';

/**
 * spec-54 phase 4.4 — aggregates for the Recogida desktop screen (mock 1l).
 *
 * Pure functions over what get_pending_manifests / get_completed_manifests
 * already return, so the screen needs no new endpoint.
 */

export interface PendingTotals {
  manifests: number;
  orders: number;
  packages: number;
}

export function pendingTotals(rows: PendingManifest[]): PendingTotals {
  return rows.reduce<PendingTotals>(
    (acc, row) => ({
      manifests: acc.manifests + 1,
      orders: acc.orders + (row.order_count ?? 0),
      packages: acc.packages + (row.package_count ?? 0),
    }),
    { manifests: 0, orders: 0, packages: 0 },
  );
}

export interface ClientCount {
  name: string;
  count: number;
}

/**
 * spec-94 fase 2 (ronda 4 review) — the literal `clientBreakdown` groups a
 * null retailer under. Exported so `matchesClient` (pickupPageHelpers.ts)
 * compares against the SAME string instead of a second copy drifting out
 * of sync with this one — the bug the review found: the "Sin cliente" chip
 * set `selectedClient = 'Sin cliente'`, but the row filters compared
 * `row.retailerName === selectedClient` directly, and a null
 * `retailerName` never equals that string, so the chip emptied the table.
 */
export const NO_CLIENT_LABEL = 'Sin cliente';

/**
 * Manifests per retailer, heaviest first — the filter chips above the
 * table. spec-94 fase 2: callers pass the UNION of all four cubes' rows,
 * not just `pending` — a retailer with every load already routed would
 * otherwise lose its chip exactly when it's needed (its manifests are
 * still there, just on a different tab). Generic over anything carrying a
 * `retailer_name`, so `PendingManifest`/`RoutedManifest`/`InTransitManifest`/
 * `CompletedManifest` rows can all be concatenated into one call.
 */
export function clientBreakdown(rows: { retailer_name: string | null }[]): ClientCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    // A manifest with no retailer still exists and still has to be picked up.
    // Dropping it would make the chips disagree with the table total.
    const name = row.retailer_name ?? NO_CLIENT_LABEL;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * spec-94 fase 1/2 — the shared shape `TodayClosuresPanel` actually needs,
 * from any of the three sources below. Not `CompletedManifest` verbatim:
 * that type carries `signature_operator`, which neither
 * `get_routed_manifests` nor `get_in_transit_manifests` return and the
 * panel does not render.
 */
export interface ClosureRow {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_packages: number | null;
  missing_count: number;
  completed_at: string;
}

function closureFrom(row: {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_packages: number | null;
  missing_count: number;
}, closedAt: string): ClosureRow {
  return {
    id: row.id,
    external_load_id: row.external_load_id,
    retailer_name: row.retailer_name,
    total_packages: row.total_packages,
    missing_count: row.missing_count,
    completed_at: closedAt,
  };
}

/**
 * Today's closures, newest first — the "Cierres de hoy" panel.
 *
 * spec-94 fase 1/2 (ronda 4 review): THREE sources, not two — the first
 * version of this section only read cubo 2 (`routed`, by `closed_at`) and
 * cubo 4 (`completed`, by `completed_at`), and missed cubo 3
 * (`inTransit`). A load closed at the dock at 09:00 (cubo 2, shows up),
 * whose route moves to `in_transit` at 11:00 (`close_pickup_route` — the
 * load falls to cubo 3, DISAPPEARS from this panel and the StatTile drops),
 * then gets received at 13:00 (back to cubo 4, reappears) — the count of
 * today's closures flickered downward for the whole trip and took the
 * missing_count with it. This panel counts a PAPERWORK EVENT ("closed"),
 * not a place, unlike the tabs — a trámite does not stop existing because
 * the truck is between two cubes.
 *
 * No duplication: the three cubes are disjoint BY PREDICATE (spec-94's
 * model — each manifest satisfies exactly one), so a manifest can only
 * ever appear in ONE of the three arrays passed in. This function does not
 * (and must not) de-duplicate by id — see pickupSummary.test.ts's
 * "does not duplicate…" case, which proves the merge doesn't introduce
 * accidental duplication on its own when the three arrays are, as they
 * are in production, already disjoint.
 */
export function completedToday(
  completed: CompletedManifest[],
  routed: RoutedManifest[] = [],
  inTransit: InTransitManifest[] = [],
  now: Date = new Date(),
): ClosureRow[] {
  const today = now.toDateString();
  const fromCompleted = completed.map((row) => closureFrom(row, row.completed_at));
  const fromClosedAt = <T extends {
    id: string;
    external_load_id: string;
    retailer_name: string | null;
    total_packages: number | null;
    missing_count: number;
    closed_at: string | null;
  }>(rows: T[]) =>
    rows
      .filter((row): row is T & { closed_at: string } => row.closed_at != null)
      .map((row) => closureFrom(row, row.closed_at));

  return [...fromCompleted, ...fromClosedAt(routed), ...fromClosedAt(inTransit)]
    .filter((row) => {
      const at = new Date(row.completed_at);
      return !Number.isNaN(at.getTime()) && at.toDateString() === today;
    })
    .sort(
      (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
    );
}
