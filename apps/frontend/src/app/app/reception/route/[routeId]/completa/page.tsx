'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import { useIncomingRoutes, type IncomingRoute } from '@/hooks/reception/useIncomingRoutes';
import { ReceptionReceipt } from '@/components/reception/ReceptionReceipt';

/**
 * spec-62 Task 22 — the acta an operator lands on right after closing a
 * reception. `get_route_reception_snapshot` (migration 20260813000005) has
 * no status filter, so the same snapshot hook the live session used keeps
 * returning this route's data once its `route_reception.status` flips to
 * `completed` — no separate "closed route" query exists or is needed.
 *
 * This is a record, not a floor tool: it reads the same on a phone and on a
 * 1440px desktop, so unlike the session page it never branches on
 * `useIsBelowLg`.
 */
export default function ReceptionCompletePage() {
  const params = useParams();
  const router = useRouter();
  const routeId = params.routeId as string;
  const { operatorId } = useOperatorId();

  const { data: snapshot, isLoading, error } = useRouteReceptionSnapshot(routeId);
  const { data: yardRoutes = [] } = useIncomingRoutes(operatorId, 'in_transit');

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Button variant="ghost" onClick={() => router.push('/app/reception')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <p className="text-status-error">
          {error?.message ?? 'No se pudo cargar el acta de recepción'}
        </p>
      </div>
    );
  }

  // The truck just closed here is still `in_transit` in the query result for
  // a beat (React Query hasn't refetched yet) — exclude it explicitly rather
  // than trusting the list to already be clean, or the acta can point at the
  // route it is itself the receipt for. Among what's left, the one that has
  // waited longest (oldest `in_transit_at`) is next, not the newest arrival.
  const nextYardRoute = yardRoutes
    .filter((r) => r.id !== routeId && r.in_transit_at)
    .reduce<IncomingRoute | null>((oldest, r) => {
      if (!oldest || !oldest.in_transit_at) return r;
      if (!r.in_transit_at) return oldest;
      return r.in_transit_at < oldest.in_transit_at ? r : oldest;
    }, null);

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <ReceptionReceipt
        snapshot={snapshot}
        nextYardRoute={nextYardRoute}
        onBack={() => router.push('/app/reception')}
        onOpenRoute={() => router.push(`/app/reception/route/${routeId}/preview`)}
      />
    </div>
  );
}
