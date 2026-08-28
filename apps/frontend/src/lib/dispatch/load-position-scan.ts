import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { validateScan } from './scan-validator';
import { scanCodesMatch } from '@/lib/scan/normalize-scan-code';

/**
 * spec-71 phase 3 — the staging pass's scan handler.
 *
 * "Scan package, then scan destination" already exists (`useQuickSortFlow`,
 * spec-68); this is the second destination kind, `load_positions`, matched
 * by `code` the way a dock zone is matched by `code` today (spec-71
 * Decision 2/Decision 3). The destination-match itself is a pure
 * normalized-code comparison (`scanCodesMatch` — the QA scanner corrupts
 * hyphens, see `lib/scan/normalize-scan-code.ts`); everything else here is
 * "resolve route via `load_positions.id -> routes.load_position_id`, then
 * reuse spec-70 phase 2's `validateScan` pointed at that route" — the exact
 * check the route-level stage scan already does, per the spec-71 Phase 3
 * bullet. No parallel validation logic against `dispatches`/`packages`.
 */

export interface PositionRow {
  id: string;
  code: string;
}

/**
 * `resolvePositionByScannedCode`'s result. `normalizeScanCode` strips
 * everything but `[A-Z0-9]`, so two legal, distinct rows — e.g. "POS-01"
 * and "POS01", both allowed because `unique_load_position_code_per_operator`
 * is on the RAW code — can normalize to the same key. Picking one with
 * `.find()` (first match, on a query with no `.order()`) would silently
 * stage the package onto an arbitrary one of them, so a collision is its
 * own outcome instead: the caller must refuse, never guess.
 */
export type ResolvePositionResult =
  | { kind: 'none' }
  | { kind: 'one'; position: PositionRow }
  | { kind: 'ambiguous'; positions: PositionRow[] };

/**
 * Pure lookup: which of an operator's active positions does this scan
 * resolve to, once both sides are normalized. Split out from the
 * DB-touching validator below so the matching rule itself is trivially
 * unit-testable without a mock Supabase client.
 */
export function resolvePositionByScannedCode(
  positions: readonly PositionRow[],
  scannedCode: string,
): ResolvePositionResult {
  // scanCodesMatch itself refuses an empty-normalized scan (all-punctuation
  // garbage like '---'), so that case falls out as 'none' here for free.
  const matches = positions.filter((p) => scanCodesMatch(scannedCode, p.code));
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'ambiguous', positions: matches };
  return { kind: 'one', position: matches[0] };
}

export type PositionScanResult =
  | {
      ok: true;
      dispatchId: string;
      packageId: string;
      routeId: string;
      positionId: string;
      positionCode: string;
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
        | 'QUERY_FAILED';
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

  // 1. Resolve the position by its (possibly corrupted/unhyphenated) code.
  const { data: positions, error: positionsError } = await supabase
    .from('load_positions')
    .select('id, code')
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (positionsError) return queryFailed(positionsError.message);

  const resolved = resolvePositionByScannedCode((positions ?? []) as PositionRow[], positionCode);
  if (resolved.kind === 'none') {
    return { ok: false, message: 'Posición no encontrada', code: 'POSITION_NOT_FOUND' };
  }
  if (resolved.kind === 'ambiguous') {
    // The mis-staging hazard, made loud instead of silent: never let an
    // arbitrary first-match decide which truck a package lands on.
    return {
      ok: false,
      message: `El código escaneado coincide con más de una posición (${resolved.positions
        .map((p) => p.code)
        .join(', ')}). Escanea el código completo o avisa a un supervisor.`,
      code: 'AMBIGUOUS_POSITION',
    };
  }
  const position = resolved.position;

  // 2. Resolve which route currently occupies it. Decision 4's occupancy
  //    predicate, verbatim: load_position_id IS NOT NULL AND
  //    load_position_released_at IS NULL AND deleted_at IS NULL — the second
  //    half is implicit here because the query is keyed on this position's id.
  const { data: routes, error: routesError } = await supabase
    .from('routes')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('load_position_id', position.id)
    .is('load_position_released_at', null)
    .is('deleted_at', null)
    .limit(1);

  if (routesError) return queryFailed(routesError.message);

  const route = routes?.[0] as { id: string } | undefined;
  if (!route) {
    return {
      ok: false,
      message: `La posición ${position.code} no tiene una ruta asignada`,
      code: 'POSITION_NOT_OCCUPIED',
    };
  }

  // 3. Reuse spec-70 phase 2's own check, pointed at the resolved route
  //    instead of a route the operator picked directly.
  const validation = await validateScan(supabase, { code: packageCode, routeId: route.id, operatorId });
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
    routeId: route.id,
    positionId: position.id,
    positionCode: position.code,
    package: {
      order_id: validation.package.order_id,
      order_number: validation.package.order_number,
      contact_name: validation.package.contact_name,
      contact_address: validation.package.contact_address,
      contact_phone: validation.package.contact_phone,
    },
  };
}

function queryFailed(message: string): PositionScanResult {
  return {
    ok: false,
    message: `No se pudo validar la posición: ${message}`,
    code: 'QUERY_FAILED',
  };
}
