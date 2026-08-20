import type { ManifestRow } from '@/components/pickup/ManifestTable';

/**
 * spec-54 mock 3j — "Sin ruta activa: iniciar ruta y sumarle manifiestos".
 * Pure grouping/selection helpers for the Cliente → Punto → Manifiesto list,
 * kept out of the component per docs/architecture.md's hook/lib layering so
 * the grouping and tri-state logic are unit-testable without rendering.
 *
 * `ManifestRow.orderCount`/`packageCount` come from `get_pending_manifests`
 * (see useManifests.ts), which derives them with `COUNT(DISTINCT o.id)` /
 * `COUNT(p.id)` — real SQL aggregates, always a number, never NULL. This is
 * a DIFFERENT source than `manifests.total_packages` (OCR/manual intake,
 * nullable), which is what manifestProgress.ts's expectedLabel/sumExpected
 * exist to guard. Nothing here needs an "unknown" (—) rendering because
 * nothing here can be unknown; the two rules are not the same rule.
 */

export interface StartRoutePointGroup {
  point: string;
  manifests: ManifestRow[];
}

export interface StartRouteClientGroup {
  client: string;
  points: StartRoutePointGroup[];
  /** Only the selectable manifests (id != null) across every point. */
  selectableIds: string[];
  pointCount: number;
  packageCount: number;
}

const NO_CLIENT = 'Sin cliente';
const NO_POINT = 'Sin punto de recogida';

/** Groups pending manifests by client, then by pickup point, preserving the
 *  order clients/points first appear in `rows` (the RPC's own ordering). */
export function groupPendingManifests(rows: ManifestRow[]): StartRouteClientGroup[] {
  const clientOrder: string[] = [];
  const clientMap = new Map<string, Map<string, ManifestRow[]>>();

  for (const row of rows) {
    const client = row.retailerName ?? NO_CLIENT;
    const point = row.pickupPoint ?? NO_POINT;

    if (!clientMap.has(client)) {
      clientMap.set(client, new Map());
      clientOrder.push(client);
    }
    const points = clientMap.get(client)!;
    if (!points.has(point)) points.set(point, []);
    points.get(point)!.push(row);
  }

  return clientOrder.map((client) => {
    const pointsMap = clientMap.get(client)!;
    const points: StartRoutePointGroup[] = Array.from(pointsMap.entries()).map(
      ([point, manifests]) => ({ point, manifests }),
    );
    const allManifests = points.flatMap((p) => p.manifests);
    return {
      client,
      points,
      selectableIds: allManifests.map((m) => m.id).filter((id): id is string => id != null),
      pointCount: points.length,
      packageCount: allManifests.reduce((sum, m) => sum + m.packageCount, 0),
    };
  });
}

export type ClientSelectionState = 'all' | 'some' | 'none';

/** Tri-state for the client-row checkbox: 'all' when every id in
 *  `selectableIds` is selected, 'none' when none are, 'some' otherwise. An
 *  empty `selectableIds` reads as 'none' (never 'all' — an empty set is not
 *  "fully selected").
 *
 * Takes a plain id array, not a `StartRouteClientGroup`, on purpose (review
 * fix): when the visible list is narrowed by "Buscar carga",
 * `groupPendingManifests(filteredRows)` only sees the manifests that match
 * the query, so a group built from it has a truncated `selectableIds` — the
 * checkbox would read "all" from 2 selected out of 2 VISIBLE, while 3 more
 * of that client's real manifests sit unselected off-screen, and the footer
 * total would then disagree with what the checkbox claims. Callers must
 * pass the client's FULL membership (from grouping the unfiltered rows),
 * never a filtered group's `selectableIds`. */
export function clientSelectionState(
  selectableIds: string[],
  selectedIds: Set<string>,
): ClientSelectionState {
  if (selectableIds.length === 0) return 'none';
  const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  if (selectedCount === 0) return 'none';
  if (selectedCount === selectableIds.length) return 'all';
  return 'some';
}
