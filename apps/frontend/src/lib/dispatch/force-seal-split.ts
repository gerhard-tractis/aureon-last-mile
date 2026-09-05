import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/** What `sealRoute`'s pending-stops query already knows about a
 * `partially_staged` row — the row id to move and the order it belongs to. */
export interface PartiallyStagedRow {
  id: string | null;
  order_id: string | null;
}

export interface SplitPartiallyStagedForForceInput {
  operatorId: string;
  /** Author of the force-seal, for `dispatches.staged_by` — not a genuine
   * scan, but the same actor-for-a-physical-confirmation-event convention
   * spec-70 already uses for that column. */
  userId?: string;
  /** The subset of pending dispatch rows `sealRoute` has already decided are
   * mixed — some of the order's packages already physically on the truck,
   * some not. This function does not re-derive that filter. */
  partiallyStagedRows: PartiallyStagedRow[];
}

export interface ForceSplitOutcome {
  split_count: number;
  split_order_ids: string[];
}

/**
 * spec-77 phase 1b — the force path no longer refuses outright on a
 * `partially_staged` stop; it splits it. The boxes already genuinely loaded
 * (`packages.loaded_at IS NOT NULL AND load_inferred = false` — never
 * `packages.status` alone, which conflates a genuine scan with spec-74's
 * optimistic backfill) travel with the route; the rest stay behind.
 *
 * Unlike `releasePendingForForce`, the `dispatches` row here is NOT
 * soft-deleted: part of the order genuinely travels with this route, so the
 * row still has to say so. It moves to a new stage, `force_split` — not
 * `staged`, because `get_move_task_snapshot`'s plan-membership filter
 * (latest def 20260902000001: `stage IN ('planned', 'partially_staged',
 * 'staged')`) would otherwise keep listing the released packages as still
 * needing to move onto this route, forever, since they will never get a
 * `dock_scans` row here. `force_split` opts a split order out of that
 * membership while `sealRoute`'s own final step (which advances staged/
 * adopted packages to `listo_para_despacho`) is widened to also include
 * it — the loaded half still has to complete the seal.
 *
 * `removal_reason` is deliberately NOT written here: that column is
 * documented (spec-70, 20260825000002) as "soft-delete plus removal_reason,
 * not a stage" — nothing is removed for a split order. The authored trace is
 * the same `audit_logs` row `seal-route.ts` writes once for the whole force
 * call, not a per-row column here.
 */
export async function splitPartiallyStagedForForce(
  supabase: SupabaseClient<Database>,
  { operatorId, userId, partiallyStagedRows }: SplitPartiallyStagedForForceInput,
): Promise<ForceSplitOutcome> {
  if (partiallyStagedRows.length === 0) {
    return { split_count: 0, split_order_ids: [] };
  }

  const dispatchIds = partiallyStagedRows.map((r) => r.id).filter((id): id is string => id != null);
  const orderIds = partiallyStagedRows.map((r) => r.order_id).filter((id): id is string => id != null);

  // Defensive symmetry with `releasePendingForForce`'s revert of a stray
  // `en_carga` sibling on a `planned` row: a package that is NOT genuinely
  // loaded (per the discriminator above) should never still read `en_carga`
  // — nothing stages a package without a genuine scan setting `loaded_at`
  // with `load_inferred = false` in the same write (stage-dispatch.ts). Kept
  // for the same reason the release path keeps it: this should be a no-op
  // in the ordinary case, not a load-bearing write.
  const { data: packages, error: packagesError } = await supabase
    .from('packages')
    .select('id, order_id, status, loaded_at, load_inferred')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds)
    .is('deleted_at', null);
  if (packagesError) throw packagesError;

  const genuinelyLoaded = (p: { loaded_at: string | null; load_inferred: boolean }): boolean =>
    p.loaded_at != null && !p.load_inferred;

  const strayIds = (packages ?? [])
    .filter((p) => p.status === 'en_carga' && !genuinelyLoaded(p))
    .map((p) => p.id)
    .filter((id): id is string => id != null);

  if (strayIds.length > 0) {
    const { error: revertError } = await supabase
      .from('packages')
      .update({ status: 'sectorizado' })
      .eq('operator_id', operatorId)
      .in('id', strayIds);
    if (revertError) throw revertError;
  }

  // The row survives — part of this order genuinely travels with the route.
  const { error: dispatchError } = await supabase
    .from('dispatches')
    .update({ stage: 'force_split', staged_at: new Date().toISOString(), staged_by: userId ?? null })
    .eq('operator_id', operatorId)
    .in('id', dispatchIds);
  if (dispatchError) throw dispatchError;

  return { split_count: partiallyStagedRows.length, split_order_ids: orderIds };
}
