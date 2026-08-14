'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { RouteQRView } from '@/components/pickup/RouteQRView';

interface RouteSummary {
  routeId: string;
  code: string;
  manifestCount: number;
  packageCount: number;
}

export default function RouteQRPage() {
  const params = useParams();
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const routeId = decodeURIComponent(params.routeId as string);
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId || !routeId) return;
    const supabase = createSPAClient();
    (async () => {
      const { data: route, error: rErr } = await supabase
        .from('pickup_routes')
        .select('id, code')
        .eq('operator_id', operatorId)
        .eq('id', routeId)
        .is('deleted_at', null)
        .single();
      if (rErr) { setError(rErr.message); return; }

      // Once the receptionist opens the batch, route_receptions.expected_count is
      // the canonical figure — it is frozen at arrival and is what the hub counts
      // against.
      const { data: rr } = await supabase
        .from('route_receptions')
        .select('expected_count')
        .eq('pickup_route_id', routeId)
        .is('deleted_at', null)
        .maybeSingle();

      const { data: manifests } = await supabase
        .from('manifests')
        .select('id')
        .eq('operator_id', operatorId)
        .eq('pickup_route_id', routeId)
        .is('deleted_at', null);
      const manifestIds = (manifests ?? []).map((m) => m.id);

      // Before that, there is no route_receptions row at all. Reading
      // expected_count here used to yield 0, so a driver mid-route showed the
      // receptionist a card reading "3 manifiestos · 0 paquetes" — this page
      // became reachable while the route is still in_progress, and the figure
      // never caught up. Count the distinct packages actually scanned instead.
      let packageCount = rr?.expected_count ?? 0;
      if (!rr && manifestIds.length > 0) {
        const { data: scans } = await supabase
          .from('pickup_scans')
          .select('package_id')
          .eq('operator_id', operatorId)
          .in('manifest_id', manifestIds)
          .eq('scan_result', 'verified')
          .is('deleted_at', null);
        const distinct = new Set<string>();
        for (const s of scans ?? []) if (s.package_id) distinct.add(s.package_id);
        packageCount = distinct.size;
      }

      setSummary({
        routeId: route.id,
        code: route.code,
        manifestCount: manifestIds.length,
        packageCount,
      });
    })();
  }, [operatorId, routeId]);

  if (error) {
    return <div className="p-6 text-status-error">{error}</div>;
  }
  if (!summary) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <RouteQRView
      routeId={summary.routeId}
      code={summary.code}
      manifestCount={summary.manifestCount}
      packageCount={summary.packageCount}
      onDismiss={() => router.push('/app/pickup')}
    />
  );
}
