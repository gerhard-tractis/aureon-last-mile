import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { resolvePositionAndRoute } from './load-position-resolve';
import { sealRoute } from './seal-route';

/**
 * spec-71 phase 4 — the position seal.
 *
 * Decision 3: "loading the truck is a single position-level seal... mirrors
 * spec-70's route-level `/seal` one level down: a position cannot be
 * sealed while any dispatch assigned to it is still un-staged." Decision 4
 * makes this a non-event to design twice: a `load_positions` row hosts at
 * most one live route at a time (the occupancy predicate
 * `load_position_id IS NOT NULL AND load_position_released_at IS NULL AND
 * deleted_at IS NULL`, enforced by `unique_route_per_active_load_position`).
 * So "seal the position" and "seal the route occupying it" are the exact
 * same event, not two facts to reconcile — sealing writes nothing new here
 * at all; it resolves the position to its occupying route
 * (`load-position-resolve.ts`, shared with the staging scan) and calls
 * `sealRoute` (`seal-route.ts`, shared with the route-level `/seal`
 * endpoint) unchanged. Per Decision 5's principle, a
 * `load_positions`-side "is this sealed" column would be exactly the
 * second writer/second vocabulary spec-70 was written to close.
 */

export type SealLoadPositionResult =
  | { ok: true; already_sealed: true; positionCode: string }
  | {
      ok: true;
      already_sealed: false;
      sealed_stops: number;
      orders_closed: number;
      positionCode: string;
    }
  | {
      ok: false;
      status: number;
      code:
        | 'POSITION_NOT_FOUND'
        | 'AMBIGUOUS_POSITION'
        | 'POSITION_NOT_OCCUPIED'
        | 'NOT_FOUND'
        | 'QUERY_FAILED'
        | 'ROUTE_NOT_OPEN'
        | 'EMPTY_ROUTE'
        | 'UNSEALED_STOPS'
        // spec-77 — `sealRoute`'s own union grew this for the force path.
        // The position seal never passes `force`, so this can never
        // actually occur here; it is only listed so `sealRoute`'s return
        // type still assigns without a cast.
        | 'FORCE_REASON_REQUIRED';
      message?: string;
      pending_count?: number;
      pending?: string[];
    };

export interface SealLoadPositionInput {
  /** What the operator scanned/typed for the position — pre-normalization. */
  positionCode: string;
  operatorId: string;
}

/**
 * Resolution failures (`POSITION_NOT_FOUND`, `AMBIGUOUS_POSITION`,
 * `POSITION_NOT_OCCUPIED`) are refused as 422 — the same status the
 * staging scan (`validatePositionScan`) uses for a bad destination code,
 * since these are all "the scanned code did not resolve to a sealable
 * route", not the route-state refusals `sealRoute` itself returns with its
 * own status. `QUERY_FAILED` is not one of those facts — a query that
 * failed to run says nothing about the position or the code, so it is a
 * 500, matching `sealRoute`'s own `QUERY_FAILED` at `seal-route.ts`
 * (review fix — this used to fall into the same 422 as a genuine
 * resolution refusal, and leaked the raw driver message to the client).
 */
export async function sealLoadPosition(
  supabase: SupabaseClient<Database>,
  input: SealLoadPositionInput,
): Promise<SealLoadPositionResult> {
  const { positionCode, operatorId } = input;

  const resolved = await resolvePositionAndRoute(supabase, { operatorId, scannedCode: positionCode });
  if (!resolved.ok) {
    if (resolved.code === 'QUERY_FAILED') {
      console.error('[sealLoadPosition] position/route resolution query failed', resolved.message);
      return { ok: false, status: 500, code: 'QUERY_FAILED', message: 'No se pudo validar la posición' };
    }
    return { ok: false, status: 422, code: resolved.code, message: resolved.message };
  }
  const { position, routeId } = resolved;

  const result = await sealRoute(supabase, { routeId, operatorId });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      code: result.code,
      message: result.message,
      pending_count: result.pending_count,
      pending: result.pending,
    };
  }

  if (result.already_sealed) {
    return { ok: true, already_sealed: true, positionCode: position.code };
  }

  return {
    ok: true,
    already_sealed: false,
    sealed_stops: result.sealed_stops,
    orders_closed: result.orders_closed,
    positionCode: position.code,
  };
}
