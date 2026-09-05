import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { isForceSealReasonCode, type ForceSealReasonCode } from './force-seal-reasons';
import { releasePendingForForce } from './force-seal-release';
import { splitPartiallyStagedForForce } from './force-seal-split';
import { writeForceSealAudit } from './force-seal-audit';
import type { ForceSealOutcome, SealRouteResult } from './seal-route';

interface PendingDispatchRow {
  id: string | null;
  order_id: string | null;
  stage?: string;
}

export interface PlanPendingStopsInput {
  routeId: string;
  operatorId: string;
  force: boolean;
  forceReasonCode?: ForceSealReasonCode | string;
  /** `route_stop_counts.pending_stops + partially_staged_stops` — already
   * computed by the caller, which also owns the EMPTY_ROUTE/QUERY_FAILED
   * checks that run before this. */
  pendingCount: number;
}

/** Nothing to release/split — either there was nothing pending, or (B1,
 * spec-77 review) a genuine refusal already ran on it. `apply` never sees
 * this shape. */
export interface PendingStopsPlanNoop {
  kind: 'noop';
}

/** A force call that is, so far, resolved to proceed: the rows it would
 * release/split, computed but NOT yet written. `routeId`'s adopted-stop gate
 * (`checkAdoptedCompleteness`) still has to run and pass before
 * `applyPendingStopsPlan` may act on this — see the B1 finding below. */
export interface PendingStopsPlanApply {
  kind: 'apply';
  reasonCode: ForceSealReasonCode;
  forceNote?: string;
  plannedRows: PendingDispatchRow[];
  partiallyStagedRows: PendingDispatchRow[];
}

export type PendingStopsPlan = PendingStopsPlanNoop | PendingStopsPlanApply;

export type PlanPendingStopsResult =
  | { ok: true; plan: PendingStopsPlan }
  | { ok: false; refusal: SealRouteResult };

/**
 * spec-70 decision 2 / spec-77 — read-only half of resolving whatever is
 * still `planned` or `partially_staged` on the route. Returns a refusal
 * (unforced, or forced with no valid reason) or a *plan* to release/split —
 * this function itself never writes anything. Extracted out of
 * `seal-route.ts` to keep that file inside the repo's 300-line budget.
 *
 * spec-77 review B1 (BLOCKER): this used to write (release + split + audit)
 * before returning, and `seal-route.ts` ran `checkAdoptedCompleteness`
 * (which can ALSO refuse) only afterward. A force call with a fully-planned
 * stop AND an incomplete adopted stop released the planned stop, wrote its
 * audit row, and only THEN discovered the adopted stop still blocks — 409,
 * but the release had already committed. Retrying (forced or not)
 * recomputed `pendingCount` at 0 for the released stop, so it could never be
 * seen again: the order was permanently off the plan and the route
 * permanently unsealable. The comment this replaces claimed the two gates
 * could "never both refuse AND write" — that was false; splitting this
 * function into a plan (read-only, can refuse) and an apply (write-only,
 * cannot refuse) is what makes it true: every gate that can refuse — this
 * one, and the caller's `checkAdoptedCompleteness` — now runs to completion
 * before `applyPendingStopsPlan` performs a single write.
 */
export async function planPendingStopsResolution(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId, force, forceReasonCode, pendingCount }: PlanPendingStopsInput,
): Promise<PlanPendingStopsResult> {
  if (pendingCount === 0) return { ok: true, plan: { kind: 'noop' } };

  // `id` and `stage` are new here (spec-77): the force path needs the row id
  // to release/split and needs to tell a fully-`planned` stop apart from a
  // `partially_staged` one, which the unforced path never had to.
  const { data: pendingRows } = await supabase
    .from('dispatches')
    .select('id, order_id, stage, orders(order_number)')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    // spec-74 phase 3: widened from `.eq('stage', 'planned')` to match
    // pendingCount above — a partially_staged order must be named in the
    // refusal too, not just counted.
    .in('stage', ['planned', 'partially_staged'])
    .is('deleted_at', null);

  const rows = pendingRows ?? [];
  const pendingName = (r: { order_id: string | null; orders: unknown }): string => {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    return (ord as { order_number?: string } | null)?.order_number ?? r.order_id ?? 'sin id';
  };
  const partiallyStagedRows = rows.filter((r) => r.stage === 'partially_staged');
  const plannedRows = rows.filter((r) => r.stage === 'planned');

  // spec-77 phase 1b — the force door covers BOTH shapes of pending stop:
  // `planned` (nobody ever touched it) is released outright
  // (`force-seal-release.ts`); `partially_staged` (some boxes already on the
  // truck, some not) is split (`force-seal-split.ts`) instead of refused —
  // an earlier version of this decision refused the whole force call the
  // moment any pending stop was `partially_staged`; that blocked the
  // canonical multi-bulto case, not an edge one.
  if (!(force && (plannedRows.length > 0 || partiallyStagedRows.length > 0))) {
    return {
      ok: false,
      refusal: {
        ok: false,
        status: 409,
        code: 'UNSEALED_STOPS',
        pending_count: pendingCount,
        pending: rows.map(pendingName),
        // RouteBuilder surfaces `message` verbatim.
        message:
          `Faltan ${pendingCount} parada(s) por estibar. ` +
          'Escanéalas o pide a un responsable que las quite de la planificación.',
      },
    };
  }

  if (!forceReasonCode || !isForceSealReasonCode(forceReasonCode)) {
    return {
      ok: false,
      refusal: {
        ok: false,
        status: 400,
        code: 'FORCE_REASON_REQUIRED',
        message: 'Se requiere un motivo para cerrar la ruta con paquetes sin cargar.',
      },
    };
  }

  return {
    ok: true,
    plan: { kind: 'apply', reasonCode: forceReasonCode, plannedRows, partiallyStagedRows },
  };
}

export interface ApplyPendingStopsPlanInput {
  routeId: string;
  operatorId: string;
  userId?: string;
  /** Optional detail alongside the code (mandatory only for `otro`,
   * enforced by the API layer's zod schema, not here). Passed separately
   * from the plan because it is not a gating fact — only the reason CODE
   * is. */
  forceNote?: string;
  plan: PendingStopsPlan;
}

/**
 * Write half of resolving pending stops: releases the fully-`planned` rows
 * and splits the `partially_staged` ones, then writes the single audit row
 * covering both. Must only be called after every refusal-capable gate —
 * this plan's own (already folded into `plan.kind`) and, critically, the
 * caller's `checkAdoptedCompleteness` — has already run and passed. Calling
 * this before that check is exactly bug B1 (spec-77 review): see
 * `planPendingStopsResolution`'s header.
 */
export async function applyPendingStopsPlan(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId, userId, forceNote, plan }: ApplyPendingStopsPlanInput,
): Promise<{ forcedOutcome?: ForceSealOutcome }> {
  if (plan.kind === 'noop') return {};

  const released = await releasePendingForForce(supabase, {
    operatorId,
    reasonCode: plan.reasonCode,
    note: forceNote,
    plannedRows: plan.plannedRows,
  });

  const split = await splitPartiallyStagedForForce(supabase, {
    operatorId,
    userId,
    partiallyStagedRows: plan.partiallyStagedRows,
  });

  // One audit row for the whole force call, covering both outcomes — a mixed
  // call (some released, some split) must leave one authored trace, not two.
  await writeForceSealAudit(supabase, {
    routeId,
    operatorId,
    userId,
    reasonCode: plan.reasonCode,
    note: forceNote,
    releasedCount: released.released_count,
    releasedOrderIds: released.released_order_ids,
    splitCount: split.split_count,
    splitOrderIds: split.split_order_ids,
  });

  return {
    forcedOutcome: {
      reason_code: plan.reasonCode,
      ...(forceNote ? { note: forceNote } : {}),
      released_count: released.released_count,
      ...(split.split_count > 0
        ? { split_count: split.split_count, split_order_ids: split.split_order_ids }
        : {}),
    },
  };
}
