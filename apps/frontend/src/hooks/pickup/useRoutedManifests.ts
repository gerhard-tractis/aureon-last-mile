import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';
import { PICKUP_QUERY_OPTIONS } from '@/hooks/pickup/useManifests';

/**
 * spec-94 fase 1/2 — cubo 2, "En punto de retiro": a manifest attached to a
 * LIVE pickup route whose status is not yet `in_transit`/`received`
 * (`get_routed_manifests`). Mixes "still being scanned" with "already
 * closed, truck not yet rolling" on purpose — that mix is the accepted cost
 * of a tab meaning a physical place, not a paperwork step (see the spec's
 * "El modelo de estados").
 */
export interface RoutedManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_orders: number | null;
  total_packages: number | null;
  created_at: string;
  pickup_point: string | null;
  labels_printed_at: string | null;
  labels_printed_by_name: string | null;
  route_code: string;
  route_started_at: string;
  /** NULL when the route's own driver_id points nowhere resolvable — kept
   * nullable rather than defaulted, same reasoning as RouteManifestRow. */
  driver_name: string | null;
  /** Live pickup_route_status_enum value as text — 'draft', 'in_progress',
   * or anything the enum grows later. Never 'in_transit'/'received': the
   * RPC's own predicate already excludes those (they belong to cubos 3/4). */
  route_status: string;
  /** `manifests.completed_at` when `status='completed'` — the "cerrada
   * HH:MM" chip. NULL means still being scanned.
   *
   * Review ronda 2 (fase 3): `RoutedManifestTable`'s `getRemoveDisabledReason`
   * reads `closed_at !== null` as a proxy for "carga completada" — it never
   * checks `status` directly, because the RPC does not return `status` at
   * all. The RPC's own `CASE WHEN m.status = 'completed' THEN m.completed_at
   * ELSE NULL END` (20261008000001, re-templated in 20261009000001) is what
   * makes that proxy sound today: every writer that sets `status='completed'`
   * also populates `completed_at` in the same statement, so the two are
   * inseparable in practice. The coupling is implicit, not enforced by a
   * constraint — if a future writer ever sets `status='completed'` without
   * `completed_at`, this proxy silently stops working and the signature
   * guard goes with it. */
  closed_at: string | null;
  /** Count of open/unresolved 'missing' discrepancies (spec-85). Rendered
   * only via the closed_at chip — a load still being scanned cannot have
   * missing packages yet. */
  missing_count: number;
  /** Count of verified pickup_scans — remove_manifest_from_route's guard 7
   * (spec-64, fase 3) rejects removal once this is > 0. */
  verified_count: number;
  /** `manifests.pickup_route_id` — the UUID `remove_manifest_from_route`
   * needs as `p_route_id`. Added in the fase 3 migration
   * (20261009000001): the fase 1 RPC only ever returned `route_code`,
   * which is the label, not the id the RPC call needs. */
  pickup_route_id: string;
}

export function useRoutedManifests(operatorId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'manifests', 'routed', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await callRpc<RoutedManifest[]>(supabase, 'get_routed_manifests');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    ...PICKUP_QUERY_OPTIONS,
  });
}
