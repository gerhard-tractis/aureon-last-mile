import type { CompletedManifest, PendingManifest } from './useManifests';
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
    const name = row.retailer_name ?? 'Sin cliente';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * spec-94 fase 1/2 — the shared shape `TodayClosuresPanel` actually needs,
 * from EITHER source below. Not `CompletedManifest` verbatim: that type
 * carries `signature_operator`, which `get_routed_manifests` does not
 * return and the panel does not render.
 */
export interface ClosureRow {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_packages: number | null;
  missing_count: number;
  completed_at: string;
}

/**
 * Today's closures, newest first — the "Cierres de hoy" panel.
 *
 * spec-94 fase 1 ("«Cierres de hoy» no puede quedarse colgando del cubo
 * 4"): a carga cerrada en el andén (`get_completed_manifests` no longer
 * returns it — it belongs to cubo 2 while the truck has not left) still
 * closed TODAY, and its `missing_count` still needs to show up here — this
 * panel is a count of PAPERWORK EVENTS ("closed"), not a place, unlike the
 * tabs. `routed` rows are keyed on `closed_at` (only populated when
 * `status='completed'`); `completed` rows keep using `completed_at`. A
 * `get_routed_manifests` row that isn't closed yet (`closed_at IS NULL`)
 * is filtered out below by the same "did this happen today" check that
 * excludes any row with no timestamp at all.
 */
export function completedToday(
  completed: CompletedManifest[],
  routed: RoutedManifest[] = [],
  now: Date = new Date(),
): ClosureRow[] {
  const today = now.toDateString();
  const fromCompleted: ClosureRow[] = completed.map((row) => ({
    id: row.id,
    external_load_id: row.external_load_id,
    retailer_name: row.retailer_name,
    total_packages: row.total_packages,
    missing_count: row.missing_count,
    completed_at: row.completed_at,
  }));
  const fromRouted: ClosureRow[] = routed
    .filter((row): row is RoutedManifest & { closed_at: string } => row.closed_at != null)
    .map((row) => ({
      id: row.id,
      external_load_id: row.external_load_id,
      retailer_name: row.retailer_name,
      total_packages: row.total_packages,
      missing_count: row.missing_count,
      completed_at: row.closed_at,
    }));

  return [...fromCompleted, ...fromRouted]
    .filter((row) => {
      const at = new Date(row.completed_at);
      return !Number.isNaN(at.getTime()) && at.toDateString() === today;
    })
    .sort(
      (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
    );
}
