import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/**
 * spec-79, split out of dispatch-local-completion.ts (F6: that file grew
 * past 300 lines once F1/F2/F3 landed). Behaviour unchanged — same
 * best-effort release + sweep this repo has always run at `dispatched`.
 */
export interface ReleaseParams {
  routeId: string;
  operatorId: string;
  userId: string;
  loadPositionId: string | null;
}

/**
 * spec-71 Decision 8: release happens at `dispatched`. Best-effort in the
 * sense that a route with no position (never assigned one) has nothing to
 * release — release_load_position is itself idempotent, but skipping the
 * call entirely when there is nothing to do avoids a pointless RPC
 * round-trip and a misleading audit_logs row. Unchanged by spec-79: this
 * whole block already swallowed its errors, and spec-79 phase 3 requires it
 * stay that way.
 */
export async function releaseLoadPosition(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId, userId, loadPositionId }: ReleaseParams,
): Promise<void> {
  if (!loadPositionId) return;

  try {
    const { error: releaseError } = await supabase.rpc('release_load_position', {
      p_route_id: routeId,
      p_operator_id: operatorId,
      p_user_id: userId,
    });
    if (releaseError) {
      console.error('[dispatch/dispatch POST] release_load_position failed', releaseError);
      return;
    }

    // changes_json carries the before/after of the release itself (Decision
    // 4: load_position_id is LEFT SET, only the released_at/_by pair moves
    // from unset to stamped).
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'release_load_position',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        load_position_id: loadPositionId,
        previous_state: 'occupied',
        new_state: 'released',
      },
      ip_address: 'unknown',
    }).then(() => null, () => null);

    // spec-71 phase 2's own bullet: a route left at load_position_id NULL is
    // "assigned a position later, whenever one is released." This release
    // just freed one, so sweep this operator's other routes that missed out
    // earlier — sweep_load_position_assignments does the scan/assign loop in
    // one round-trip, bounded and oldest-created-first. Best-effort like
    // every other call in this block — never fails the dispatch request.
    try {
      const { data: sweepResults, error: sweepError } = await supabase.rpc(
        'sweep_load_position_assignments',
        { p_operator_id: operatorId, p_user_id: userId },
      );
      if (sweepError) {
        console.error('[dispatch/dispatch POST] sweep_load_position_assignments failed', sweepError);
        return;
      }
      if (Array.isArray(sweepResults) && sweepResults.length) {
        // One audit_logs row per assignment the sweep actually made, exactly
        // like the existing assign_load_position call sites.
        await Promise.all(
          (sweepResults as { route_id: string; load_position_id: string }[]).map((swept) =>
            supabase.from('audit_logs').insert({
              operator_id: operatorId,
              user_id: userId,
              action: 'assign_load_position',
              resource_type: 'routes',
              resource_id: swept.route_id,
              changes_json: { load_position_id: swept.load_position_id, via: 'sweep_after_release' },
              ip_address: 'unknown',
            }).then(() => null, () => null),
          ),
        );
      }
    } catch (sweepErr) {
      console.error('[dispatch/dispatch POST] sweep_load_position_assignments threw', sweepErr);
    }
  } catch (releaseErr) {
    // The route has already transitioned to `dispatched` (and DT already
    // has it); a release failure must not surface as a dispatch failure.
    console.error('[dispatch/dispatch POST] release_load_position threw', releaseErr);
  }
}
