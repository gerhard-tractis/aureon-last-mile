import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { ForceSealReasonCode } from './force-seal-reasons';

/** What a successful force actually did to the fully-`planned` stops — a
 * `partially_staged` stop is a different outcome shape, see
 * `force-seal-split.ts`'s `ForceSplitOutcome`. `seal-route.ts` composes both
 * into the one object the caller (and the `2i` screen, a later phase) sees. */
export interface ForceSealReleaseOutcome {
  released_count: number;
  released_order_ids: string[];
}

interface PendingDispatchRow {
  id: string | null;
  order_id: string | null;
}

export interface ReleasePendingForForceInput {
  operatorId: string;
  reasonCode: ForceSealReasonCode;
  note?: string;
  /** The subset of pending dispatch rows `sealRoute` has already decided are
   * safe to release outright — every one `stage = 'planned'`, never
   * `partially_staged`. This function does not re-derive that filter. */
  plannedRows: PendingDispatchRow[];
}

/**
 * spec-77 — does the actual release for `sealRoute`'s force path:
 * soft-deletes the fully-`planned` dispatch rows, reverts any (defensively —
 * should be none) `en_carga` sibling packages back to `sectorizado`. Extracted
 * out of `seal-route.ts` so that file stays inside the repo's 300-line budget
 * and this side-effecting piece can be read on its own.
 *
 * spec-77 phase 1b: this function no longer writes the `audit_logs` row
 * itself. A single force call can release fully-`planned` stops AND split
 * `partially_staged` ones (`force-seal-split.ts`) in the same request, and
 * that has to leave exactly one authored trace, not one per helper —
 * `seal-route.ts` now calls `writeForceSealAudit` (`force-seal-audit.ts`)
 * once, after both have run.
 *
 * Same effect as the manager's `DELETE /packages/[pkgId]` (spec-70 decision
 * 3) — soft-delete off the plan, so the order reappears in Pre-ruta's
 * unrouted cohort the moment this route stops being "active" for it
 * (`get_pre_route_snapshot` excludes an order only while a non-deleted
 * dispatch ties it to a route in an active status) — but reached from
 * inside the force-seal itself, never through that manager-only endpoint:
 * the crew was denied that door, not this one. Soft delete, never hard
 * delete, and `removal_reason` always carries the code (+ optional note) —
 * nothing here drops an order from the plan without a trace.
 */
export async function releasePendingForForce(
  supabase: SupabaseClient<Database>,
  { operatorId, reasonCode, note, plannedRows }: ReleasePendingForForceInput,
): Promise<ForceSealReleaseOutcome> {
  const releaseIds = plannedRows.map((r) => r.id).filter((id): id is string => id != null);
  const releasedOrderIds = plannedRows.map((r) => r.order_id).filter((id): id is string => id != null);
  const reasonText = note ? `${reasonCode}: ${note}` : reasonCode;

  if (releaseIds.length > 0) {
    const { error: releaseError } = await supabase
      .from('dispatches')
      .update({ deleted_at: new Date().toISOString(), removal_reason: reasonText })
      .eq('operator_id', operatorId)
      .in('id', releaseIds);
    if (releaseError) throw releaseError;
  }

  if (releasedOrderIds.length > 0) {
    // Defensive symmetry with the manager DELETE path. A `planned`
    // dispatch's packages should never have advanced past their dock-ready
    // status — nothing stages a package without first flipping its dispatch
    // off `planned` — so this is a no-op in the ordinary case, kept for the
    // same reason the DELETE handler keeps it: 'sectorizado', never
    // 'asignado' (breakage #9, spec-70).
    await supabase
      .from('packages')
      .update({ status: 'sectorizado' })
      .eq('operator_id', operatorId)
      .eq('status', 'en_carga')
      .in('order_id', releasedOrderIds);
  }

  return {
    released_count: releaseIds.length,
    released_order_ids: releasedOrderIds,
  };
}
