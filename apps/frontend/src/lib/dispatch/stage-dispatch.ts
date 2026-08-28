import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { DISPATCHABLE_STATUSES } from './scan-validator';
import type { RouteStatus } from './types';

/**
 * spec-71 phase 3 review item 5 — the write both stage-scan handlers make
 * once their own validation accepts a scan: `[id]/scan/route.ts`'s 'stage'
 * branch and `load-positions/scan/route.ts` copied the same two updates
 * verbatim. Extracted so they cannot drift; behaviour is unchanged from
 * both call sites, including the packages update's error not being
 * checked — that matches what both handlers already did before this
 * extraction, not a new omission.
 */
export interface StageDispatchInput {
  dispatchId: string;
  orderId: string;
  operatorId: string;
  userId: string;
}

/**
 * The second half of a staging write, split out on its own: `[id]/scan
 * /route.ts`'s 'adopt' branch needs this (a package just scanned in
 * unplanned still has to advance) but not the dispatch-row update above it
 * — that branch INSERTs a new dispatch row instead of updating one, so it
 * cannot go through `stageDispatch` itself. `stageDispatch` below composes
 * this with the dispatch update for the two call sites that need both.
 */
export async function advancePackagesToEnCarga(
  supabase: SupabaseClient<Database>,
  input: { operatorId: string; orderId: string },
): Promise<void> {
  // Whatever state the validator accepted is what has to advance. Filtering
  // on a single status alone would leave a package scanned in from a
  // different path sitting at its old status while its dispatch row already
  // said staged.
  await supabase
    .from('packages')
    .update({ status: 'en_carga' })
    .eq('operator_id', input.operatorId)
    .eq('order_id', input.orderId)
    .in('status', [...DISPATCHABLE_STATUSES]);
}

export async function stageDispatch(
  supabase: SupabaseClient<Database>,
  input: StageDispatchInput,
): Promise<void> {
  const now = new Date().toISOString();

  // The row Pre-ruta (or the route-level scan) already seeded is updated in
  // place — never a second insert.
  const { error: stageError } = await supabase
    .from('dispatches')
    .update({ stage: 'staged', staged_at: now, staged_by: input.userId })
    .eq('id', input.dispatchId)
    .eq('operator_id', input.operatorId);
  if (stageError) throw stageError;

  await advancePackagesToEnCarga(supabase, { operatorId: input.operatorId, orderId: input.orderId });
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
