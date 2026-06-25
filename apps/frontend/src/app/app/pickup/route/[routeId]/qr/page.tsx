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
      // Fetch route + reception summary in two cheap calls — the route_receptions
      // row carries the frozen expected_count which is the canonical "packages
      // on this truck" figure for the QR view.
      const { data: route, error: rErr } = await supabase
        .from('pickup_routes')
        .select('id, code')
        .eq('operator_id', operatorId)
        .eq('id', routeId)
        .is('deleted_at', null)
        .single();
      if (rErr) { setError(rErr.message); return; }

      const { data: rr } = await supabase
        .from('route_receptions')
        .select('expected_count')
        .eq('pickup_route_id', routeId)
        .maybeSingle();

      const { count: mCount } = await supabase
        .from('manifests')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', operatorId)
        .eq('pickup_route_id', routeId)
        .is('deleted_at', null);

      setSummary({
        routeId: route.id,
        code: route.code,
        manifestCount: mCount ?? 0,
        packageCount: rr?.expected_count ?? 0,
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
