import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { validateScan } from './scan-validator';
import { resolvePositionAndRoute } from './load-position-resolve';
import type { DispatchStage } from './types';

/**
 * spec-71 phase 3 — the staging pass's scan handler.
 *
 * "Scan package, then scan destination" already exists (`useQuickSortFlow`,
 * spec-68); this is the second destination kind, `load_positions`, matched
 * by `code` the way a dock zone is matched by `code` today (spec-71
 * Decision 2/Decision 3). Position resolution (ambiguity guard + occupying
 * route) lives in `load-position-resolve.ts`, shared with phase 4's
 * position seal; everything else here is "reuse spec-70 phase 2's
 * `validateScan` pointed at that route" — the exact check the route-level
 * stage scan already does. No parallel validation logic against
 * `dispatches`/`packages`.
 */

// Re-exported for callers/tests that resolve a position match without a
// Supabase client (the pure matching rule itself).
export {
  resolvePositionByScannedCode,
  type PositionRow,
  type ResolvePositionResult,
} from './load-position-resolve';

export type PositionScanResult =
  | {
      ok: true;
      dispatchId: string;
      packageId: string;
      routeId: string;
      positionId: string;
      positionCode: string;
      // spec-74 phase 2 review item 3. Carried through so the handler can
      // pass it to `stageDispatch`, which needs it to decide whether to
      // write `staged` or preserve `adopted` — see `ScanAction.currentStage`.
      currentStage: DispatchStage;
      package: {
        order_id: string;
        order_number: string;
        contact_name: string | null;
        contact_address: string | null;
        contact_phone: string | null;
      };
    }
  | {
      ok: false;
      message: string;
      code:
        | 'POSITION_NOT_FOUND'
        | 'AMBIGUOUS_POSITION'
        | 'POSITION_NOT_OCCUPIED'
        | 'NOT_PLANNED_FOR_POSITION'
        | 'NOT_FOUND'
        | 'WRONG_STATUS'
        | 'ALREADY_IN_ROUTE'
        | 'ALREADY_STAGED'
        | 'IN_CONSOLIDATION'
        | 'QUERY_FAILED'
        // spec-76 task 3 review, escalated decision — this staging pass
        // reuses `validateScan` (scan-validator.ts) verbatim, so any code
        // that validator can now return must be representable here too.
        | 'NOT_ON_DOCK';
    };

interface PositionScanInput {
  /** The package barcode (or order number — validateScan's own fallback). */
  packageCode: string;
  /** What the operator scanned for the destination — pre-normalization. */
  positionCode: string;
  operatorId: string;
}

/**
 * Validates one staging scan: package code, then a `load_positions.code`
 * instead of a `dock_zones.code`. Does not write anything — mirrors
 * `validateScan`'s contract so the API route stays the only place that
 * touches the database, exactly like the existing route-level scan handler.
 */
export async function validatePositionScan(
  supabase: SupabaseClient<Database>,
  input: PositionScanInput,
): Promise<PositionScanResult> {
  const { packageCode, positionCode, operatorId } = input;

  const resolved = await resolvePositionAndRoute(supabase, { operatorId, scannedCode: positionCode });
  if (!resolved.ok) {
    return { ok: false, message: resolved.message, code: resolved.code };
  }
  const { position, routeId } = resolved;

  // Reuse spec-70 phase 2's own check, pointed at the resolved route
  // instead of a route the operator picked directly.
  const validation = await validateScan(supabase, { code: packageCode, routeId, operatorId });
  if (!validation.ok) {
    return { ok: false, message: validation.message, code: validation.code };
  }

  // The staging pass only ever confirms a package the plan already put on
  // this route (spec-71 Phase 3: "validate that the package's order is
  // planned on the route occupying the scanned position"). `adopt` means
  // the package was never planned onto this route at all — that is a wrong
  // destination, not a new plan the position scan is entitled to create.
  if (validation.action.kind !== 'stage') {
    return {
      ok: false,
      message: `Este paquete no está planificado para la ruta de la posición ${position.code}`,
      code: 'NOT_PLANNED_FOR_POSITION',
    };
  }

  return {
    ok: true,
    dispatchId: validation.action.dispatchId,
    packageId: validation.packageId,
    routeId,
    positionId: position.id,
    positionCode: position.code,
    currentStage: validation.action.currentStage,
    package: {
      order_id: validation.package.order_id,
      order_number: validation.package.order_number,
      contact_name: validation.package.contact_name,
      contact_address: validation.package.contact_address,
      contact_phone: validation.package.contact_phone,
    },
  };
}
