import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { isForceSealReasonCode, type ForceSealReasonCode } from './force-seal-reasons';
import { releasePendingForForce } from './force-seal-release';
import { splitPartiallyStagedForForce } from './force-seal-split';
import { writeForceSealAudit } from './force-seal-audit';
import type { ForceSealOutcome, SealRouteResult } from './seal-route';

export interface ResolvePendingStopsInput {
  routeId: string;
  operatorId: string;
  force: boolean;
  forceReasonCode?: ForceSealReasonCode | string;
  forceNote?: string;
  userId?: string;
  /** `route_stop_counts.pending_stops + partially_staged_stops` — already
   * computed by the caller, which also owns the EMPTY_ROUTE/QUERY_FAILED
   * checks that run before this. */
  pendingCount: number;
}

export type PendingStopsResolution =
  | { ok: true; forcedOutcome?: ForceSealOutcome }
  | { ok: false; refusal: SealRouteResult };

/**
 * spec-70 decision 2 / spec-77 — extracted out of `seal-route.ts` to keep
 * that file inside the repo's 300-line budget. Resolves whatever is still
 * `planned` or `partially_staged` on the route: refuses (unforced, or forced
 * with no valid reason) or, with a valid reason, releases the untouched
 * stops and splits the mixed ones (spec-77 phase 1b) — never both refusing
 * AND writing.
 */
export async function resolvePendingStops(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId, force, forceReasonCode, forceNote, userId, pendingCount }: ResolvePendingStopsInput,
): Promise<PendingStopsResolution> {
  if (pendingCount === 0) return { ok: true };

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

  const released = await releasePendingForForce(supabase, {
    operatorId,
    reasonCode: forceReasonCode,
    note: forceNote,
    plannedRows,
  });

  const split = await splitPartiallyStagedForForce(supabase, {
    operatorId,
    userId,
    partiallyStagedRows,
  });

  // One audit row for the whole force call, covering both outcomes — a mixed
  // call (some released, some split) must leave one authored trace, not two.
  await writeForceSealAudit(supabase, {
    routeId,
    operatorId,
    userId,
    reasonCode: forceReasonCode,
    note: forceNote,
    releasedCount: released.released_count,
    releasedOrderIds: released.released_order_ids,
    splitCount: split.split_count,
    splitOrderIds: split.split_order_ids,
  });

  return {
    ok: true,
    forcedOutcome: {
      reason_code: forceReasonCode,
      ...(forceNote ? { note: forceNote } : {}),
      released_count: released.released_count,
      ...(split.split_count > 0
        ? { split_count: split.split_count, split_order_ids: split.split_order_ids }
        : {}),
    },
  };
}
