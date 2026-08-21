'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';
import {
  useRouteManifests,
  useUnassignedManifests,
} from '@/hooks/pickup/useRouteManifests';
import { useAddManifestToRoute } from '@/hooks/pickup/useAddManifestToRoute';
import { useClosePickupRoute } from '@/hooks/pickup/useClosePickupRoute';
import { isManifestComplete } from '@/lib/pickup/manifestProgress';
import { RouteProgressHeader } from '@/components/pickup/RouteProgressHeader';
import { RouteMapPlaceholder } from '@/components/pickup/RouteMapPlaceholder';
import { NextManifestCard } from '@/components/pickup/NextManifestCard';
import { RouteCompleteNotice } from '@/components/pickup/RouteCompleteNotice';
import { UpcomingManifestList } from '@/components/pickup/UpcomingManifestList';
import { RouteManifestList } from '@/components/pickup/RouteManifestList';
import { AddManifestSheet } from '@/components/pickup/AddManifestSheet';
import { CloseRouteButton } from '@/components/pickup/CloseRouteButton';
import { toast } from 'sonner';

const MANIFEST_LIST_PANEL_ID = 'route-manifest-list-panel';

export default function ActiveRoutePage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const {
    data: route,
    isLoading: routeLoading,
    isError: routeError,
    refetch: refetchRoute,
  } = useActivePickupRoute(operatorId);
  const { data: routeManifests = [], isLoading: rmLoading } = useRouteManifests(
    route?.id ?? null,
    operatorId,
  );
  const { data: unassigned = [], isLoading: unLoading } =
    useUnassignedManifests(operatorId);
  const addMut = useAddManifestToRoute(operatorId);
  const closeMut = useClosePickupRoute(operatorId);

  if (routeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  // spec-61: a FAILED lookup is not an empty one. The route now comes from a
  // single RPC, so one bad response -- a missing function, a stale PostgREST
  // schema cache, a dropped connection -- fails the whole thing, and after
  // React Query exhausts its retries `data` is undefined with `isLoading`
  // false. Falling through to the empty state below would tell a leader who
  // HAS an open route that they do not, which is the 3j double-open this task
  // exists to prevent. Offer the retry instead.
  if (routeError) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4 text-center">
        <p className="text-text">No pudimos cargar tu ruta.</p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={() => refetchRoute()}>Reintentar</Button>
          <Button variant="outline" onClick={() => router.push('/app/pickup')}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4 text-center">
        <p className="text-text">No tienes una ruta activa.</p>
        <Button onClick={() => router.push('/app/pickup')}>Volver</Button>
      </div>
    );
  }

  const totalVerified = routeManifests.reduce((s, m) => s + m.verified_count, 0);

  // `useRouteManifests` now orders by created_at ASCENDING (append-only
  // queue — see the hook), so array position is stable across refetches and
  // across adding a new manifest from this same screen. "Next" is the first
  // one genuinely incomplete (a null or zero total_packages counts as
  // incomplete/unknown, never as done). When nothing is incomplete the route
  // IS finished — no fallback card that would advertise verification work
  // that no longer exists.
  const nextIndex = routeManifests.findIndex((m) => !isManifestComplete(m));
  const nextManifest = nextIndex === -1 ? null : routeManifests[nextIndex];
  const routeComplete = routeManifests.length > 0 && nextManifest === null;
  // Upcoming manifests are the ones AFTER the highlighted one in the same
  // order — not "everything except it", which could list already-completed
  // manifests as if they were still ahead.
  const upcoming = nextManifest
    ? routeManifests.slice(nextIndex + 1, nextIndex + 4)
    : [];

  const goToScan = (loadId: string) =>
    router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`);

  const handleAdd = (manifestId: string) => {
    addMut.mutate(
      { routeId: route.id, manifestId },
      {
        onSuccess: () => {
          toast.success('Manifiesto agregado');
          setSheetOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleClose = () => {
    closeMut.mutate(
      { routeId: route.id },
      {
        onSuccess: () => {
          router.push(`/app/pickup/route/${route.id}/qr`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const manifestListVisible = routeManifests.length === 0 || showAll;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4 pb-24">
      <RouteProgressHeader route={route} manifests={routeManifests} isLoading={rmLoading} />

      <RouteMapPlaceholder pickupLocation={nextManifest?.pickup_location ?? null} />

      {rmLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : (
        <>
          {nextManifest && (
            <NextManifestCard manifest={nextManifest} index={nextIndex} onVerify={goToScan} />
          )}
          {routeComplete && <RouteCompleteNotice />}

          <UpcomingManifestList manifests={upcoming} />

          {manifestListVisible && (
            <div id={MANIFEST_LIST_PANEL_ID}>
              <h2 className="text-sm font-semibold text-text mb-2">
                Manifiestos en la ruta
              </h2>
              <RouteManifestList manifests={routeManifests} onManifestClick={goToScan} />
            </div>
          )}

          <div className="flex items-center gap-2">
            {routeManifests.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                className="flex-1 min-h-[44px]"
                aria-expanded={showAll}
                // Only points at a real id: the panel doesn't exist in the
                // DOM until expanded, and a dangling aria-controls idref is
                // worse than omitting the attribute.
                aria-controls={manifestListVisible ? MANIFEST_LIST_PANEL_ID : undefined}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? 'Ocultar manifiestos'
                  : routeManifests.length === 1
                    ? 'Ver el manifiesto'
                    : `Ver los ${routeManifests.length} manifiestos`}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="min-h-[44px] min-w-[44px]"
              aria-label="Agregar manifiesto"
              data-testid="open-add-manifest"
              onClick={() => setSheetOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <AddManifestSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        manifests={unassigned}
        isLoading={unLoading}
        isAdding={addMut.isPending}
        onPick={handleAdd}
      />

      <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <CloseRouteButton
            totalVerified={totalVerified}
            isSubmitting={closeMut.isPending}
            onClose={handleClose}
          />
        </div>
      </div>
    </div>
  );
}
