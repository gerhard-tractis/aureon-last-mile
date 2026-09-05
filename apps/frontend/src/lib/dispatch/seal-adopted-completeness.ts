import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { DISPATCHABLE_STATUSES } from './scan-validator';
import type { SealRouteResult } from './seal-route';

/**
 * spec-74 phase 3 — the `adopted` finding, extracted out of `seal-route.ts`
 * to keep that file inside the repo's 300-line budget (spec-77 phase 1b
 * added the force-split path on top of an already-over-budget file).
 * Behaviour unchanged from the inline version this replaces.
 *
 * `dispatches.stage` for an adopted row is NEVER rewritten to
 * `partially_staged`/`staged` (stage-dispatch.ts preserves it forever,
 * spec-74 phase 2 review item 3), so `route_stop_counts`'
 * pending_stops/partially_staged_stops — both purely `stage`-keyed — can
 * never see an adopted order's own incompleteness. An adopted 2-bulto order
 * where only one box was ever scanned reads as "adopted_stops: 1" regardless
 * of the sibling still sitting on the andén, which is the exact QA repro
 * spec-74 exists to kill, just wearing a different stage name. So
 * completeness for adopted rows is checked here directly against the
 * per-package fact (`packages.loaded_at`), not against `stage` at all — the
 * only place that reads it that way.
 *
 * Returns a refusal (`UNSEALED_STOPS`/`QUERY_FAILED`) if any adopted order
 * has an outstanding package, or `null` if the seal may proceed.
 */
export async function checkAdoptedCompleteness(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId }: { routeId: string; operatorId: string },
): Promise<SealRouteResult | null> {
  const { data: adoptedRows, error: adoptedError } = await supabase
    .from('dispatches')
    .select('order_id, orders(order_number)')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    .eq('stage', 'adopted')
    .is('deleted_at', null);

  if (adoptedError) {
    console.error('[sealRoute] adopted dispatches lookup failed', adoptedError);
    return {
      ok: false,
      status: 500,
      code: 'QUERY_FAILED',
      message: 'No se pudo verificar el estado de la ruta',
    };
  }

  const adoptedOrderIds = (adoptedRows ?? [])
    .map((d) => d.order_id)
    .filter((id): id is string => id != null);

  if (adoptedOrderIds.length === 0) return null;

  // spec-74 phase 3 review Fix 1 (BLOCKER), same reasoning as
  // stage-dispatch.ts's recompute: a package outside DISPATCHABLE_STATUSES
  // (scan-validator.ts) cannot be scanned, so it must not be able to block
  // completeness here either — otherwise an adopted order with a
  // `dañado`/`retenido`/etc. sibling is unsealable forever, with the
  // refusal pointing at a box the scanner refuses to accept.
  const { data: outstandingPkgs, error: outstandingError } = await supabase
    .from('packages')
    .select('order_id')
    .eq('operator_id', operatorId)
    .in('order_id', adoptedOrderIds)
    .is('deleted_at', null)
    .is('loaded_at', null)
    .in('status', [...DISPATCHABLE_STATUSES]);

  if (outstandingError) {
    console.error('[sealRoute] outstanding adopted packages lookup failed', outstandingError);
    return {
      ok: false,
      status: 500,
      code: 'QUERY_FAILED',
      message: 'No se pudo verificar el estado de la ruta',
    };
  }

  const outstandingOrderIds = new Set(
    (outstandingPkgs ?? []).map((p) => p.order_id).filter((id): id is string => id != null),
  );

  if (outstandingOrderIds.size === 0) return null;

  const pending = (adoptedRows ?? [])
    .filter((d) => d.order_id != null && outstandingOrderIds.has(d.order_id))
    .map((d) => {
      const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
      return ord?.order_number ?? d.order_id;
    });

  return {
    ok: false,
    status: 409,
    code: 'UNSEALED_STOPS',
    pending_count: outstandingOrderIds.size,
    pending,
    message:
      `Faltan ${outstandingOrderIds.size} parada(s) por estibar. ` +
      'Escanéalas o pide a un responsable que las quite de la planificación.',
  };
}
