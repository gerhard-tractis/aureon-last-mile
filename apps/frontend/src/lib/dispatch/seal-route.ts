import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { RouteStatus } from './types';
import type { ForceSealReasonCode } from './force-seal-reasons';
import { checkAdoptedCompleteness } from './seal-adopted-completeness';
import { planPendingStopsResolution, applyPendingStopsPlan } from './seal-pending-stops';

/** What `sealRoute`'s force path did, composed from the fully-`planned` stops
 * released (`force-seal-release.ts`) and the `partially_staged` stops split
 * (`force-seal-split.ts`, spec-77 phase 1b). `split_count`/`split_order_ids`
 * are omitted entirely (not zeroed) when nothing was split, so a
 * force-on-fully-planned-route caller sees exactly the shape it always has. */
export interface ForceSealOutcome {
  reason_code: ForceSealReasonCode;
  note?: string;
  released_count: number;
  split_count?: number;
  split_order_ids?: string[];
}

/**
 * spec-71 phase 4 — the route-level seal's core logic, extracted verbatim
 * (behaviour unchanged) so the position-level seal can call the exact same
 * event instead of inventing a parallel one. Spec-71 Decision 3: sealing a
 * position IS sealing the route that occupies it — a position hosts at
 * most one live route (Decision 4's occupancy predicate), so there is no
 * second "is this loaded yet" fact to keep in sync. `[id]/seal/route.ts`
 * (auth + params) and the new `load-positions/seal/route.ts` (auth +
 * position/route resolution) both reduce to calling this.
 *
 * States a route may be sealed from, and what each means — moved here
 * unchanged from the original header:
 *   draft    — a route this deploy finds sitting there. The old builder left
 *              routes at `draft` through its whole scan flow, and phase 1's
 *              backfill moved their dispatch rows straight to `staged`
 *              without touching route status. Without this, every such route
 *              is unsealable and undispatchable forever — refused here in the
 *              same way `planned` is, walking the same three-step path.
 *   planned  — orders assigned, nothing staged. Always refuses (every stop is
 *              pending), except the empty-route case which gets its own code.
 *   loading  — the normal path.
 *   loaded   — already sealed. Idempotent success; the button is at a dock and
 *              gets double-tapped.
 */
const SEALABLE_FROM: readonly string[] = ['draft', 'planned', 'loading'];

/** planned/draft -> loaded is not a legal edge; it goes through loading. */
const SEAL_WALK: Record<string, readonly RouteStatus[]> = {
  draft: ['planned', 'loading', 'loaded'],
  // Unreachable insurance, not a real path: a `planned` route can only carry
  // staged rows if the scan handler's stage RPC succeeded, and that RPC is
  // what moves the route off `planned` in the first place — a throw on that
  // RPC aborts the scan handler before any row is staged. Kept anyway so a
  // route arriving here at `planned` (a hand-edited row, a future caller)
  // still walks a real path instead of getting stuck one step short of
  // `loaded`.
  planned: ['loading', 'loaded'],
  loading: ['loaded'],
};

export type SealRouteResult =
  | { ok: true; already_sealed: true }
  | {
      ok: true;
      already_sealed: false;
      sealed_stops: number;
      orders_closed: number;
      forced?: ForceSealOutcome;
    }
  | {
      ok: false;
      status: number;
      code:
        | 'NOT_FOUND'
        | 'QUERY_FAILED'
        | 'ROUTE_NOT_OPEN'
        | 'EMPTY_ROUTE'
        | 'UNSEALED_STOPS'
        | 'FORCE_REASON_REQUIRED';
      message?: string;
      pending_count?: number;
      pending?: string[];
    };

export interface SealRouteInput {
  routeId: string;
  operatorId: string;
  /**
   * spec-77 — the crew may close a route short (missing boxes stay on the
   * dock), but only with a reason. Off by default: an unforced call must
   * behave exactly as it always has, `UNSEALED_STOPS` included — this is
   * spec-70 decision 2's invariant, and cutting a hole in it is this
   * field's entire job, not a side effect of it.
   */
  force?: boolean;
  /** Required whenever `force` actually has anything to release. Validated
   * against the closed set in `force-seal-reasons.ts` — a free-text reason
   * is refused the same as a missing one. */
  forceReasonCode?: ForceSealReasonCode | string;
  /** Optional detail alongside the code (mandatory only for `otro`, enforced
   * by the API layer's zod schema, not here). */
  forceNote?: string;
  /** Author of the force-seal, for the audit row. Not required for the
   * unforced path — existing callers (`seal-load-position.ts`) never force. */
  userId?: string;
}

/**
 * Seals a route: refuses while any stop is still `planned` (spec-70
 * decision 2), advances staged/adopted packages to
 * `listo_para_despacho`, and walks `routes.status` to `loaded` via
 * `transition_route_status`. Does not touch the request/session — callers
 * own auth and turn this result into an HTTP response.
 *
 * spec-77 — `force` cuts an audited hole in decision 2: a route may close
 * with boxes still sitting on the dock, only with a reason from the closed
 * vocabulary. Two shapes of pending stop, two outcomes (spec-77 phase 1b):
 * a `planned` stop — nobody ever touched it — is released outright
 * (`force-seal-release.ts`); a `partially_staged` stop — some of the order's
 * packages already physically on the truck, some not — is split
 * (`force-seal-split.ts`): the loaded half travels on to
 * `listo_para_despacho`, the rest is released to the dock. (An earlier
 * version of this decision refused the whole force call on ANY
 * `partially_staged` stop; that blocked the canonical multi-bulto case, not
 * an edge one — see spec-77 phase 1b and the widened note on spec-70
 * decision 2.)
 */
export async function sealRoute(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId, force = false, forceReasonCode, forceNote, userId }: SealRouteInput,
): Promise<SealRouteResult> {
  const { data: route, error: routeError } = await supabase
    .from('routes')
    .select('id, status')
    .eq('id', routeId)
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .single();

  // PGRST116 is "no row matched" — a genuine 404. Anything else is a query
  // that failed to run at all, which is not the same fact and must not be
  // reported as one.
  if (routeError && routeError.code !== 'PGRST116') {
    console.error('[sealRoute] route lookup failed', routeError);
    return { ok: false, status: 500, code: 'QUERY_FAILED', message: 'No se pudo verificar la ruta' };
  }
  if (!route) return { ok: false, status: 404, code: 'NOT_FOUND' };

  if (route.status === 'loaded') {
    return { ok: true, already_sealed: true };
  }

  if (!SEALABLE_FROM.includes(route.status)) {
    return {
      ok: false,
      status: 409,
      code: 'ROUTE_NOT_OPEN',
      message: `La ruta no se puede cerrar en estado ${route.status}`,
    };
  }

  // Counts come from the view, never from routes.planned_stops — that
  // column drifted by construction and is what made EMPTY_ROUTE unreliable.
  //
  // spec-74 phase 3: partially_staged_stops added (20260902000001). Read
  // alongside pending_stops so the completeness gate below can fold both
  // into one refusal — a route with any dispatch still `planned` OR
  // `partially_staged` is not ready to seal (spec-74 Decision 6 / the
  // blocker checklist's UNSEALED_STOPS widening).
  const { data: counts, error: countsError } = await supabase
    .from('route_stop_counts')
    .select('total_stops, pending_stops, partially_staged_stops, staged_stops, adopted_stops')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    .maybeSingle();

  if (countsError) {
    console.error('[sealRoute] route_stop_counts query failed', countsError);
    return {
      ok: false,
      status: 500,
      code: 'QUERY_FAILED',
      message: 'No se pudo verificar el estado de la ruta',
    };
  }

  const total = counts?.total_stops ?? 0;
  // spec-74 phase 3: widened from `pending_stops` alone. Before this, a
  // `partially_staged` order counted in total_stops but in NEITHER
  // pending_stops NOR staged_stops (route_stop_counts' own gap — see
  // 20260902000001), so pendingCount came out 0 and the seal opened on a
  // route with real boxes still on the dock. This is the production failure
  // spec-74 exists to fix.
  const pendingCount = (counts?.pending_stops ?? 0) + (counts?.partially_staged_stops ?? 0);

  if (total === 0) {
    return {
      ok: false,
      status: 422,
      code: 'EMPTY_ROUTE',
      message: 'No se puede cerrar una ruta sin paradas',
    };
  }

  // spec-70 decision 2 / spec-77 — extracted to `seal-pending-stops.ts`:
  // computes a PLAN for whatever is still `planned`/`partially_staged` —
  // refuse (unforced, or forced with no valid reason) or a plan to release
  // the untouched stops and split the mixed ones (phase 1b). Writes NOTHING
  // — see the B1 note below for why that matters.
  const pendingPlan = await planPendingStopsResolution(supabase, {
    routeId,
    operatorId,
    force,
    forceReasonCode,
    pendingCount,
  });
  if (!pendingPlan.ok) return pendingPlan.refusal;

  // spec-74 phase 3 — the `adopted` finding (`seal-adopted-completeness.ts`).
  // `dispatches.stage` never tells an incomplete adopted order apart from a
  // complete one; only `packages.loaded_at` does.
  //
  // spec-77 review B1 (BLOCKER, fixed here): this MUST run before
  // `applyPendingStopsPlan` below. It used to run AFTER the release/split/
  // audit had already committed, so a refusal here left them permanently
  // stuck — the released row soft-deleted and out of `pendingCount`'s reach,
  // the split row's `force_split` stage excluded from this same lookup's
  // `.in('planned','partially_staged')` — neither retryable. Every
  // refusal-capable gate (this one and the plan above) must run before the
  // one write step, not after.
  if ((counts?.adopted_stops ?? 0) > 0) {
    const adoptedRefusal = await checkAdoptedCompleteness(supabase, { routeId, operatorId });
    if (adoptedRefusal) return adoptedRefusal;
  }

  // Both gates passed — only now may the plan write anything.
  const { forcedOutcome } = await applyPendingStopsPlan(supabase, {
    routeId,
    operatorId,
    userId,
    forceNote,
    plan: pendingPlan.plan,
  });

  // spec-74 phase 3 blocker checklist note: this does NOT need
  // 'partially_staged' added. By the time execution reaches here, both
  // guards above have already returned — pendingCount > 0 (which now
  // includes partially_staged_stops) and the adopted-completeness check —
  // so no `partially_staged` row, and no adopted row with an outstanding
  // package, can exist on this route any more. Adding it here would be
  // dead code, matching nothing; left out deliberately rather than for
  // having been missed.
  //
  // spec-77 phase 1b: 'force_split' IS added here. A split order's
  // `dispatches` row is never soft-deleted (part of it genuinely travels)
  // and its stage is `force_split`, not `staged` — this is the ONE place
  // that stage still has to reach: the loaded half of a split order still
  // has to advance from `en_carga` to `listo_para_despacho`, the same as
  // any other order this route actually ships.
  const { data: sealedRows } = await supabase
    .from('dispatches')
    .select('order_id')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    .in('stage', ['staged', 'adopted', 'force_split'])
    .is('deleted_at', null);

  const orderIds = (sealedRows ?? [])
    .map((d) => d.order_id)
    .filter((id): id is string => id != null);

  if (orderIds.length > 0) {
    const { error: pkgError } = await supabase
      .from('packages')
      .update({ status: 'listo_para_despacho' })
      .eq('operator_id', operatorId)
      .eq('status', 'en_carga')
      .in('order_id', orderIds);
    if (pkgError) throw pkgError;
  }

  for (const to of SEAL_WALK[route.status] ?? []) {
    const { error: transitionError } = await supabase.rpc('transition_route_status', {
      p_route_id: routeId,
      p_operator_id: operatorId,
      p_to_status: to,
    });
    if (transitionError) throw transitionError;
  }

  return {
    ok: true,
    already_sealed: false,
    sealed_stops: total,
    orders_closed: orderIds.length,
    ...(forcedOutcome ? { forced: forcedOutcome } : {}),
  };
}
