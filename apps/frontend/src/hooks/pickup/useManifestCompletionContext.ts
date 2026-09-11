import { useEffect, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export interface ManifestCompletionContext {
  manifestId: string | null;
  manifestStartedAt: string | null;
  /** spec-80 fase 5 (5i) — retailer for the closed-header subtitle. */
  retailerName: string | null;
  /** spec-80 fase 5 (5i) — `pickup_route_id`, so `5i` can look up the other
   *  manifests on this same route ("Sigue en PR-…"). */
  routeId: string | null;
  /** spec-80 fase 5 (5i) — the route's `code` (e.g. "PR-2026-0148"), the
   *  same field `RouteProgressHeader`/`PickupMobileActiveRoute` already show
   *  as the route's public identifier. */
  routeExternalId: string | null;
  operatorName: string;
}

/**
 * spec-80 fase 5 — extracted from `complete/[loadId]/page.tsx` (5f/5i) to
 * keep that file under the repo's file-size convention: this hook's data
 * was one `useEffect` that had grown to cover both the pre-existing 5f
 * fields (manifestId, manifestStartedAt, operatorName) and the new 5i ones
 * (retailerName, routeId, routeExternalId) — one round trip per table, no
 * behavior change from moving it here.
 *
 * `app → components → hooks → lib → Supabase` — this hook is where a plain
 * `.from().select()` (not a `close_manifest`-style RPC; there is no write
 * here) belongs, same layer as `usePickupScans`/`useManifestDocuments`.
 */
export function useManifestCompletionContext(
  operatorId: string | null,
  loadId: string,
): ManifestCompletionContext {
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [manifestStartedAt, setManifestStartedAt] = useState<string | null>(null);
  const [retailerName, setRetailerName] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [routeExternalId, setRouteExternalId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('');

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id, started_at, retailer_name, pickup_route_id')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setManifestId(data.id);
        setManifestStartedAt(data.started_at);
        setRetailerName(data.retailer_name ?? null);
        setRouteId(data.pickup_route_id ?? null);
        if (!data.pickup_route_id) return;
        supabase
          .from('pickup_routes')
          .select('code')
          .eq('operator_id', operatorId)
          .eq('id', data.pickup_route_id)
          .is('deleted_at', null)
          .single()
          .then(({ data: routeData }) => {
            setRouteExternalId(routeData?.code ?? null);
          });
      });

    // Get user full name for operator signature
    supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id;
      if (!userId) return;
      supabase
        .from('users')
        .select('full_name')
        .eq('id', userId)
        .single()
        .then(({ data: userData }) => {
          setOperatorName(userData?.full_name ?? data.user?.email ?? '');
        });
    });
  }, [operatorId, loadId]);

  return { manifestId, manifestStartedAt, retailerName, routeId, routeExternalId, operatorName };
}
