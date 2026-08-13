import { createSPAClient } from '@/lib/supabase/client';

export const ROUTE_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Translates a human-typed pickup-route code (`PR-2026-0001`) into its UUID,
 * scoped to the operator. `open_route_reception` only takes a route id, and a
 * receptionist whose camera fails has nothing but the printed code — so the
 * typed-code path needs exactly this one lookup and nothing more.
 *
 * Read-only on purpose: the status check and every side effect belong to
 * `open_route_reception`, which runs them in one transaction. Returns null
 * when the code matches nothing, so callers show "Ruta no encontrada" without
 * ever reaching the RPC.
 */
export async function resolveRouteId(
  operatorId: string,
  code: string,
): Promise<string | null> {
  const supabase = createSPAClient();
  const { data, error } = await supabase
    .from('pickup_routes')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('code', code)
    .is('deleted_at', null)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0].id;
}
