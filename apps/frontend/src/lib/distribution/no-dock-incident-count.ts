import { determineDockZone } from './sectorization-engine';
import type { DockZone, PackageOrder } from './sectorization-engine';

/**
 * spec-96 fase 4 — `4a`'s "Sin andén asignado" incident row.
 *
 * A no-dock incident is an order whose comuna resolves (it is not the
 * unrecognised-comuna case, `get_unmatched_comunas`'s predicate) but no
 * active dock zone covers it — `determineDockZone`'s `flagged: true`
 * branch, the SAME predicate `PendingMobileList` (`4d`) already recomputes
 * per order rather than trusting the zone-bucket-level flag (spec-68 Fase 3
 * review, finding #5): the consolidation bucket legitimately mixes a
 * future-dated retention, a genuinely-unmapped comuna and a null-comuna
 * order under one `zone_id`, so only the per-order recompute tells them
 * apart.
 *
 * Deliberately NOT exported from `PendingMobileList.tsx` — that file is
 * Fase 2's surface; duplicating this ~5-line predicate here avoids a
 * cross-phase edit on a file this phase does not own. Follow-up to
 * record, not to do now: once Fase 2 lands, this should become the HOME
 * of the predicate, renamed to expose both shapes (`flaggedNoDockOrders`
 * returning the array, `countNoDockIncidents` a one-line `.length` over
 * it) — and `PendingMobileList.tsx` should import from here instead.
 *
 * Review fix — `determineDockZone` throws exactly one way: no
 * consolidation zone in `zones`. The guard below already prevents every
 * call reaching that throw, so the `try/catch` that used to wrap it was
 * redundant (both paths returned the same thing) AND a liability: a bare
 * `catch { return false }` would have swallowed any *other*, genuine
 * future error into a silent 0. Removed rather than narrowed, since the
 * guard alone is the correct, sufficient check.
 *
 * Two costs `distribution/page.tsx`'s wiring declares rather than fixes:
 * (1) its `usePendingSectorization` call is an unbounded fetch (no
 * `.limit()`) reduced to this one integer; at prod scale (~61k packages)
 * PostgREST's default row cap would silently truncate it, under-
 * reporting the count. `useOpenBatchesByZone` has no such problem — one
 * row per zone per refetch cycle, `idx_dock_batches_operator_id` covers
 * it. (2) the guard above returning `0` for a *successfully* empty
 * `zones` array (an operator with genuinely zero dock zones configured)
 * reads identically to "no incidents" — `usePendingSectorization`'s own
 * `enabled` gate never runs in that state, so this function never even
 * sees those orders. Neither is fixed here: (1) needs a count-only
 * source (ideally folded into `get_distribution_overview`); (2) needs a
 * change to `usePendingSectorization`'s enabling condition — Fase 8's
 * file this round.
 */
export function countNoDockIncidents(orders: PackageOrder[], zones: DockZone[], today: string): number {
  if (!zones.some((z) => z.is_consolidation)) return 0;
  return orders.filter((order) => determineDockZone(order, zones, today).flagged).length;
}
