import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { ForceSealReasonCode } from './force-seal-reasons';

/** What a successful force actually did — surfaced so the caller (and the
 * `2i` screen, a later phase) can show what was released, not just that
 * sealing succeeded. */
export interface ForceSealOutcome {
  reason_code: ForceSealReasonCode;
  note?: string;
  released_count: number;
}

interface PendingDispatchRow {
  id: string | null;
  order_id: string | null;
}

export interface ReleasePendingForForceInput {
  routeId: string;
  operatorId: string;
  /** Author of the force-seal, for the audit row. */
  userId?: string;
  reasonCode: ForceSealReasonCode;
  note?: string;
  /** The subset of pending dispatch rows `sealRoute` has already decided are
   * safe to force through — every one `stage = 'planned'`, never
   * `partially_staged`. This function does not re-derive that filter. */
  plannedRows: PendingDispatchRow[];
}

/**
 * spec-77 — does the actual release for `sealRoute`'s force path:
 * soft-deletes the fully-`planned` dispatch rows, reverts any (defensively —
 * should be none) `en_carga` sibling packages back to `sectorizado`, and
 * writes the audit row. Extracted out of `seal-route.ts` so that file stays
 * inside the repo's 300-line budget and this side-effecting piece can be
 * read on its own.
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
  { routeId, operatorId, userId, reasonCode, note, plannedRows }: ReleasePendingForForceInput,
): Promise<ForceSealOutcome> {
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

  // Audit: reason, author, time (`timestamp` defaults to now()), count — one
  // row, the same mechanism `packages/[pkgId]/route.ts` uses for a manager
  // removal, distinguished from it by `action`.
  await supabase
    .from('audit_logs')
    .insert({
      operator_id: operatorId,
      user_id: userId ?? 'unknown',
      action: 'force_seal_route',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        reason_code: reasonCode,
        note: note ?? null,
        released_count: releaseIds.length,
        released_order_ids: releasedOrderIds,
      },
      ip_address: 'unknown',
    })
    .then(() => null, () => null);

  return {
    reason_code: reasonCode,
    ...(note ? { note } : {}),
    released_count: releaseIds.length,
  };
}
