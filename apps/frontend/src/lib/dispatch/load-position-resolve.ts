import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { scanCodesMatch } from '@/lib/scan/normalize-scan-code';

/**
 * spec-71 phase 3/4 — "which position, and which route occupies it" is the
 * first half of both the staging scan (`load-position-scan.ts`) and the
 * position seal (`seal-load-position.ts`). Extracted here so the two share
 * one resolution path instead of two copies of the same ambiguity guard and
 * occupancy query drifting apart.
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
 * resolve to an arbitrary one of them, so a collision is its own outcome
 * instead: the caller must refuse, never guess.
 */
export type ResolvePositionResult =
  | { kind: 'none' }
  | { kind: 'one'; position: PositionRow }
  | { kind: 'ambiguous'; positions: PositionRow[] };

/**
 * Pure lookup: which of an operator's active positions does this scan
 * resolve to, once both sides are normalized. Split out from the
 * DB-touching lookup below so the matching rule itself is trivially
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

export type PositionAndRouteResult =
  | { ok: true; position: PositionRow; routeId: string }
  | {
      ok: false;
      code: 'POSITION_NOT_FOUND' | 'AMBIGUOUS_POSITION' | 'POSITION_NOT_OCCUPIED' | 'QUERY_FAILED';
      message: string;
    };

/**
 * Resolves a scanned code to a live position and the route currently
 * occupying it — the two DB round trips both the staging scan and the
 * position seal need before they diverge into their own write. Never picks
 * an arbitrary match: an ambiguous scan and an unoccupied position both
 * refuse loudly (`AMBIGUOUS_POSITION` / `POSITION_NOT_OCCUPIED`).
 */
export async function resolvePositionAndRoute(
  supabase: SupabaseClient<Database>,
  input: { operatorId: string; scannedCode: string },
): Promise<PositionAndRouteResult> {
  const { operatorId, scannedCode } = input;

  const { data: positions, error: positionsError } = await supabase
    .from('load_positions')
    .select('id, code')
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (positionsError) return queryFailed(positionsError.message);

  const resolved = resolvePositionByScannedCode((positions ?? []) as PositionRow[], scannedCode);
  if (resolved.kind === 'none') {
    return { ok: false, code: 'POSITION_NOT_FOUND', message: 'Posición no encontrada' };
  }
  if (resolved.kind === 'ambiguous') {
    // The mis-staging hazard, made loud instead of silent: never let an
    // arbitrary first-match decide which truck a package (or a seal) lands
    // on.
    return {
      ok: false,
      code: 'AMBIGUOUS_POSITION',
      message: `El código escaneado coincide con más de una posición (${resolved.positions
        .map((p) => p.code)
        .join(', ')}). Escanea el código completo o avisa a un supervisor.`,
    };
  }
  const position = resolved.position;

  // Decision 4's occupancy predicate, verbatim: load_position_id IS NOT
  // NULL AND load_position_released_at IS NULL AND deleted_at IS NULL — the
  // second half is implicit here because the query is keyed on this
  // position's id.
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
      code: 'POSITION_NOT_OCCUPIED',
      message: `La posición ${position.code} no tiene una ruta asignada`,
    };
  }

  return { ok: true, position, routeId: route.id };
}

function queryFailed(message: string): PositionAndRouteResult {
  return {
    ok: false,
    code: 'QUERY_FAILED',
    message: `No se pudo validar la posición: ${message}`,
  };
}
