'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import { useReceptionScan } from '@/hooks/reception/useReceptionScan';
import { useCompleteRouteReception } from '@/hooks/reception/useCompleteRouteReception';
import { ReceptionScanner } from '@/components/reception/ReceptionScanner';
import { ReceptionCounts } from '@/components/reception/ReceptionCounts';
import { RouteSwitcherColumn, type RouteTab } from '@/components/reception/RouteSwitcherColumn';
import { SyncQueuePanel } from '@/components/reception/SyncQueuePanel';
import { useIncomingRoutes } from '@/hooks/reception/useIncomingRoutes';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { ConsolidatedScanList } from '@/components/reception/ConsolidatedScanList';
import { FinalizeReceptionButton } from '@/components/reception/FinalizeReceptionButton';
import { ReopenRouteButton } from '@/components/reception/ReopenRouteButton';
import { ReceptionMobileSession } from '@/components/reception/ReceptionMobileSession';
import { ReceptionMobileSessionSkeleton } from '@/components/reception/ReceptionMobileSessionSkeleton';
import { ReceptionMobileErrorCard } from '@/components/reception/ReceptionMobileErrorCard';
import { useIsBelowLg } from '@/hooks/useViewport';
import type { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';

export default function RouteReceptionPage() {
  const params = useParams();
  const router = useRouter();
  const routeId = params.routeId as string;
  const { operatorId } = useOperatorId();
  const isBelowLg = useIsBelowLg();

  const [userId, setUserId] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] =
    useState<ReceptionScanValidationResult | null>(null);

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const [routeTab, setRouteTab] = useState<RouteTab>('unloading');
  const { data: snapshot, isLoading, error } = useRouteReceptionSnapshot(routeId);

  // Left column: switch between routes without going back to the landing.
  const { data: incoming = [] } = useIncomingRoutes(operatorId, 'in_progress');
  const { data: unloading = [] } = useIncomingRoutes(operatorId, 'in_transit');
  const { data: closed = [] } = useIncomingRoutes(operatorId, 'received');
  const sync = useSyncQueue();
  const scanMutation = useReceptionScan();
  const completeMutation = useCompleteRouteReception();

  const handleScan = useCallback(
    (barcode: string) => {
      if (!snapshot || !operatorId || !userId) return;
      scanMutation.mutate(
        {
          barcode,
          routeId,
          routeReceptionId: snapshot.route_reception.id,
          operatorId,
          userId,
        },
        {
          onSuccess: (result) => {
            setLastScanResult(result);
            // No auto-hide timer. This block must persist until the next
            // scan — an operator looks at the box in their hands and back
            // at the screen, and a result that vanished on a timer leaves
            // them unable to tell whether that box registered, with no
            // recovery but rescanning something that may already be
            // counted (spec-62 task 19). Do not restore the old 3s
            // setTimeout as "cleanup".
          },
        },
      );
    },
    [snapshot, operatorId, userId, routeId, scanMutation],
  );

  const handleFinalize = useCallback(
    (notes: string | null) => {
      completeMutation.mutate(
        { routeId, discrepancyNotes: notes },
        {
          onSuccess: () => {
            toast.success('Recepción completada');
            // spec-62 task 23 — closing lands on the acta (Task 22's
            // /completa route), not back on the list. The acta is the
            // record of what was expected, what arrived and the note just
            // written; both the desktop and mobile trees share this one
            // destination — there is no reason a mobile andén operator is
            // denied the receipt a desktop receptionist gets.
            router.push(`/app/reception/route/${routeId}/completa`);
          },
          onError: (e) => {
            toast.error(e.message ?? 'Error al finalizar recepción');
          },
        },
      );
    },
    [routeId, completeMutation, router],
  );

  if (isLoading) {
    // Gap fix (post spec-62 task 19) — this used to be a single desktop-shaped
    // `max-w-2xl` skeleton reached even on a phone, because the mobile branch
    // sat below these guards. Below `lg`, this is the state seen longest on a
    // slow andén connection, so it now mirrors ReceptionMobileSession's own
    // chrome (fixed header band, scan field, a couple of history rows) at the
    // same heights and radii — never a centred spinner — so nothing jumps
    // when the real data lands.
    if (isBelowLg) {
      return <ReceptionMobileSessionSkeleton />;
    }
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !snapshot) {
    // Same gap: a route that fails to load is most likely to be seen by an
    // andén operator with a truck in front of them. The mobile card states
    // the failure in Spanish and always offers a 44px+ way back to the
    // reception list — never a dead end.
    if (isBelowLg) {
      return (
        <ReceptionMobileErrorCard
          message={error?.message ?? 'No se pudo cargar la ruta'}
          onBack={() => router.push('/app/reception')}
        />
      );
    }
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Button variant="ghost" onClick={() => router.push('/app/reception')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <p className="text-status-error">
          {error?.message ?? 'No se pudo cargar la ruta'}
        </p>
      </div>
    );
  }

  // spec-62 task 19 — below `lg` the andén operator gets ReceptionMobileSession
  // instead of the desktop three-column tree, exactly like /app/reception
  // already branches (chunk 2). It brings its own scanning and closing, so
  // none of RouteSwitcherColumn, SyncQueuePanel, ReceptionCounts,
  // ConsolidatedScanList, ReceptionScanner, FinalizeReceptionButton or
  // ReopenRouteButton mount here. Reopening deliberately has no mobile
  // equivalent — it is a hub correction, not an andén action.
  if (isBelowLg) {
    return (
      <ReceptionMobileSession
        snapshot={snapshot}
        lastScanResult={lastScanResult}
        syncStatus={sync.status}
        queuedCount={sync.queuedCount}
        isScanPending={scanMutation.isPending}
        isFinalizePending={completeMutation.isPending}
        onScan={handleScan}
        onFinalize={handleFinalize}
      />
    );
  }

  const routesForTab =
    routeTab === 'incoming' ? incoming : routeTab === 'unloading' ? unloading : closed;

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/app/reception')}
          aria-label="Volver a recepción"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-[1.1] tracking-[-.02em] text-text">
            Ruta {snapshot.route.code} · conteo en recepción
          </h1>
          <p className="text-[12.5px] leading-none text-text-secondary">
            {snapshot.route.driver_name ?? 'Sin conductor'}
            {snapshot.route.plate ? ` · ${snapshot.route.plate}` : ''} ·{' '}
            {snapshot.manifests.length}{' '}
            {snapshot.manifests.length === 1 ? 'manifiesto' : 'manifiestos'}
          </p>
        </div>
        {completeMutation.isPending && (
          <Loader2 className="ml-auto h-4 w-4 animate-spin text-text-muted" />
        )}
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[300px_1fr_340px]">
        <RouteSwitcherColumn
          tab={routeTab}
          onTabChange={setRouteTab}
          routes={routesForTab}
          counts={{
            incoming: incoming.length,
            unloading: unloading.length,
            closed: closed.length,
          }}
          activeRouteId={routeId}
          activeProgress={{
            received: snapshot.route_reception.received_count,
            expected: snapshot.route_reception.expected_count,
          }}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <ReceptionScanner
            onScan={handleScan}
            disabled={scanMutation.isPending}
            lastScanResult={lastScanResult}
          />

          <ReceptionCounts
            expected={snapshot.route_reception.expected_count}
            received={snapshot.route_reception.received_count}
            unexpected={snapshot.route_reception.unexpected_count}
          />

          <ConsolidatedScanList
            manifests={snapshot.manifests}
            expectedPackages={snapshot.expected_packages}
            scans={snapshot.scans}
          />

          <FinalizeReceptionButton
            receivedCount={snapshot.route_reception.received_count}
            expectedCount={snapshot.route_reception.expected_count}
            unexpectedCount={snapshot.route_reception.unexpected_count}
            isPending={completeMutation.isPending}
            onFinalize={handleFinalize}
          />

          {/* Escape hatch for a QR scanned before the truck was really
              unloaded. Hides itself the moment a package is received — from
              then on the correct move is to finish and note the discrepancy. */}
          <ReopenRouteButton
            routeId={routeId}
            code={snapshot.route.code}
            receivedCount={snapshot.route_reception.received_count}
          />
        </div>

        <SyncQueuePanel
          status={sync.status}
          queuedCount={sync.queuedCount}
          recent={sync.recent}
          onRetry={sync.retryNow}
          isRetrying={sync.isRetrying}
        />
      </div>
    </div>
  );
}
