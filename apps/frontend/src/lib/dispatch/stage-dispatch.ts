import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { DISPATCHABLE_STATUSES } from './scan-validator';
import type { DispatchStage, RouteStatus } from './types';

/**
 * spec-71 phase 3 review item 5 — the write both stage-scan handlers make
 * once their own validation accepts a scan: `[id]/scan/route.ts`'s 'stage'
 * branch and `load-positions/scan/route.ts` copied the same two updates
 * verbatim. Extracted so they cannot drift; behaviour is unchanged from
 * both call sites, including the packages update's error not being
 * checked — that matches what both handlers already did before this
 * extraction, not a new omission.
 *
 * spec-74 phase 2 note on `orderId`: it is not used by this file's own
 * writes any more (the packages advance below is scoped to `packageId`
 * alone), but is kept on the input because phase 3's per-dispatch
 * completeness recompute ("are any of this order's OTHER live packages
 * still unloaded?") needs it, and both call sites already have it in hand
 * from the scan they just validated.
 *
 * spec-74 phase 2 note on `dispatches.stage`: on a `planned` row this still
 * sets `staged` unconditionally on every accepted scan, including the
 * SECOND and later bultos of a multi-bulto order. That is a deliberate,
 * temporary over-claim — the dispatch reads "staged" while packages may
 * still be on the dock — carried forward exactly as spec-74 Decision item 4
 * requires: phase 3 is what teaches this function to write
 * `partially_staged` while any live package is still outstanding and
 * `staged` only once none are. Do not read this phase as having fixed
 * dispatch-level completeness; it has only fixed the scanner's ability to
 * accept every bulto. An `adopted` row is a separate case, not covered by
 * that over-claim — see `currentStage` below and review item 3.
 */
export interface StageDispatchInput {
  dispatchId: string;
  orderId: string;
  packageId: string;
  operatorId: string;
  userId: string;
  /**
   * spec-74 phase 2 review item 3. The dispatch row's `stage` as the
   * validator found it, so this function knows whether to write `staged`
   * or to preserve `adopted`. Without this, a sibling bulto scanned after
   * the order was `adopted` (never planned onto this route at all)
   * silently rewrote the row to `staged` — the "never planned" fact then
   * survived only in `adopted_reason`, and `route_stop_counts.adopted_stops`
   * undercounted every order this happened to.
   */
  currentStage: DispatchStage;
}

/**
 * The second half of a staging write, split out on its own: `[id]/scan
 * /route.ts`'s 'adopt' branch needs this (a package just scanned in
 * unplanned still has to advance) but not the dispatch-row update above it
 * — that branch INSERTs a new dispatch row instead of updating one, so it
 * cannot go through `stageDispatch` itself. `stageDispatch` below composes
 * this with the dispatch update for the two call sites that need both.
 *
 * spec-74 phase 2. Used to be scoped by `order_id` alone, sweeping EVERY
 * package of the order to `en_carga` in one write. That reasoning ("whatever
 * state the validator accepted is what has to advance") was about which
 * STATUSES were eligible, not about how many packages should move — but
 * because a multi-bulto order's dispatch row is one row per ORDER, sweeping
 * by `order_id` silently advanced every sibling bulto too, on the strength
 * of scanning just one of them. That is the exact lie spec-74 exists to
 * kill (see spec-74's "Why it happens" #2): it does not still hold. This
 * now advances the ONE package actually scanned, and records the per-box
 * load fact phase 1 added (`loaded_at`/`loaded_by`) in the same write —
 * `packages_loaded_by_requires_loaded_at_chk` requires both together.
 * `load_inferred` IS set here now (to `false`) — spec-74 phase 2 review
 * item 1: a package can arrive at this write already `load_inferred = true`
 * (phase 1's backfill), and the whole point of accepting this scan is that
 * a real scan just happened. The row stops being an assumption the moment
 * someone scans it, so the flag must be cleared, not merely left alone —
 * phase 1's migration owns SETTING it true (the one-time optimistic
 * backfill); clearing it on a genuine scan is this file's job.
 */
export async function advancePackagesToEnCarga(
  supabase: SupabaseClient<Database>,
  input: { operatorId: string; packageId: string; userId: string },
): Promise<void> {
  const now = new Date().toISOString();
  // spec-74 phase 2 review item 1. Used to be `.is('loaded_at', null)` —
  // a belt-and-suspenders idempotency guard against a concurrent duplicate
  // write for the same box. That guard now ALSO no-ops on a genuinely
  // inferred (backfilled) row forever, since such a row already has
  // `loaded_at` set: the real scan this function exists to record would
  // silently fail to write. Widened to admit a genuine scan over EITHER an
  // untouched row (`loaded_at IS NULL`) OR an inferred one
  // (`load_inferred = true`) — the idempotency intent survives for a
  // genuinely-scanned row: `loaded_at IS NOT NULL AND load_inferred =
  // false` still matches neither branch of the OR, so a second real scan
  // of the same box is still refused here (on top of the validator's own
  // ALREADY_STAGED gate).
  //
  // spec-74 phase 2 review item 4. The write can legitimately match zero
  // rows (operator/package mismatch, a status that slipped out of
  // DISPATCHABLE_STATUSES between validation and here, or a race that lost
  // to a concurrent scan) while the caller's dispatch update has already
  // committed and would otherwise report success regardless. `.select('id')`
  // makes the result auditable instead of fire-and-forget; both the error
  // and the empty-match case now throw so the caller's existing try/catch
  // (both scan route handlers) turns it into a 500 rather than a 201 that
  // lied about the box being loaded.
  const { data: updated, error: pkgError } = await supabase
    .from('packages')
    .update({ status: 'en_carga', loaded_at: now, loaded_by: input.userId, load_inferred: false })
    .eq('operator_id', input.operatorId)
    .eq('id', input.packageId)
    .in('status', [...DISPATCHABLE_STATUSES])
    .or('loaded_at.is.null,load_inferred.eq.true')
    .select('id');

  if (pkgError) throw pkgError;
  if (!updated || updated.length === 0) {
    throw new Error(
      `advancePackagesToEnCarga: no package row matched (package ${input.packageId}, operator ${input.operatorId}) — the scan was accepted but nothing was written`,
    );
  }
}

/**
 * spec-74 phase 3. Returns the `DispatchStage` actually written, not just
 * `void` — both HTTP callers ([id]/scan/route.ts and
 * load-positions/scan/route.ts) build their JSON response's `stage` field
 * from a caller-side guess ("adopted stays adopted, everything else is
 * staged") that predates `partially_staged` entirely. Left as a guess, a
 * response would claim `stage: 'staged'` for a scan this function actually
 * recomputed to `partially_staged` — the exact kind of reader this phase's
 * blocker checklist exists to catch, just one call away from the write
 * itself instead of in a separate module. Returning the real value removes
 * the guess instead of teaching it a third case to also get right.
 */
export async function stageDispatch(
  supabase: SupabaseClient<Database>,
  input: StageDispatchInput,
): Promise<DispatchStage> {
  // spec-74 phase 3 review Fix 2 (BLOCKER) + Fix 3 (BLOCKER).
  //
  // Fix 2 — write ordering. This used to write the dispatch row FIRST, then
  // advance the package, which throws on zero rows matched. On a single
  // package the failure mode was: recompute says `staged` -> dispatch
  // written `staged` -> package write throws -> the handler 500s, but the
  // dispatch is left saying `staged` with `loaded_at IS NULL` on the
  // package. `pendingCount` in seal-route.ts is then 0 and the seal opens
  // on a box that was never loaded — the ORIGINAL bug spec-74 exists to
  // fix, reached via the error path instead of the happy path. Writing the
  // package FIRST means a failure now leaves the dispatch behind reality
  // (fail-safe: still `planned`/`partially_staged`, refusing the seal)
  // instead of ahead of it (fail-open).
  //
  // Fix 3 — concurrency. Even with the ordering fixed, doing "read
  // outstanding packages, then write dispatch.stage" as two separate
  // app-layer statements left a window: two bultos of one order scanned
  // concurrently could each read the other as still outstanding before
  // either write landed, and both would write `partially_staged` — stuck
  // forever with nothing left to scan, once both packages actually finish
  // loading. `recompute_dispatch_stage` (20260902000001) closes that
  // window structurally: it locks the dispatch row FOR UPDATE, recomputes
  // from `packages`, and writes stage/staged_at/staged_by in ONE
  // statement, in the database. A second concurrent call for the same
  // dispatch blocks on the lock and then recomputes against the first
  // call's fully-committed package state — not a stale in-process
  // snapshot. This also makes Fix 2's ordering structural rather than
  // best-effort: the recompute cannot run before the package write it
  // depends on, because this function only calls it afterward.
  //
  // `input.currentStage` is no longer read here — the RPC re-reads the
  // dispatch row's live stage under its own row lock, which is strictly
  // fresher than anything validateScan could have cached. The field stays
  // on `StageDispatchInput` for callers/tests that still construct it, and
  // because `ScanAction`'s `currentStage` is used elsewhere (messaging),
  // but this function's own decision no longer depends on it.
  await advancePackagesToEnCarga(supabase, {
    operatorId: input.operatorId,
    packageId: input.packageId,
    userId: input.userId,
  });

  const { data: nextStage, error: recomputeError } = await supabase.rpc('recompute_dispatch_stage', {
    p_dispatch_id: input.dispatchId,
    p_operator_id: input.operatorId,
    p_order_id: input.orderId,
    p_user_id: input.userId,
  });
  if (recomputeError) throw recomputeError;
  if (!nextStage) {
    throw new Error(
      `stageDispatch: recompute_dispatch_stage returned no stage (dispatch ${input.dispatchId}, operator ${input.operatorId})`,
    );
  }

  return nextStage as DispatchStage;
}

/**
 * spec-71 phase 3 review item 5 — the route-level stage handler already
 * refuses a scan against a sealed/dispatched route (`ROUTE_NOT_OPEN`); the
 * position handler had no equivalent check at all. Shared here so both
 * gates agree on exactly which statuses still admit loading, the same set
 * `[id]/scan/route.ts`'s own `LOADING_WALK` keys on.
 */
export const LOADING_WALK: Record<string, readonly RouteStatus[]> = {
  draft: ['planned', 'loading'],
  planned: ['loading'],
  loading: [],
};

export function isRouteOpenForLoading(status: string): boolean {
  return LOADING_WALK[status] !== undefined;
}
