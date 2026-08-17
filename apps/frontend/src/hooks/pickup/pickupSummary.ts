import type { CompletedManifest, PendingManifest } from './useManifests';

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

/** Manifests per retailer, heaviest first — the filter chips above the table. */
export function clientBreakdown(rows: PendingManifest[]): ClientCount[] {
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

/** Today's closures, newest first — the "Cierres de hoy" panel. */
export function completedToday(
  rows: CompletedManifest[],
  now: Date = new Date(),
): CompletedManifest[] {
  const today = now.toDateString();
  return rows
    .filter((row) => {
      if (!row.completed_at) return false;
      const at = new Date(row.completed_at);
      return !Number.isNaN(at.getTime()) && at.toDateString() === today;
    })
    .sort(
      (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
    );
}
