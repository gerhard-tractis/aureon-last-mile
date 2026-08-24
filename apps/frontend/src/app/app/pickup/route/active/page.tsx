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
import { useRemoveManifestFromRoute } from '@/hooks/pickup/useRemoveManifestFromRoute';
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
import { CancelRouteButton } from '@/components/pickup/CancelRouteButton';
import { toast } from 'sonner';

const MANIFEST_LIST_PANEL_ID = 'route-manifest-list-panel';

export default function ActiveRoutePage() {
  const router = useRouter();
  const { operatorId, userId } = useOperatorId();
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
  const removeMut = useRemoveManifestFromRoute(operatorId);
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

  // spec-64 Task 4 — the counterpart to handleAdd. Passed to
  // RouteManifestList UNCONDITIONALLY (not gated on route.driver_id === userId
  // like CancelRouteButton below): crew can add manifests through the
  // ungated AddManifestSheet, so gating removal to the driver would let a
  // crew member attach a carga and then be unable to detach the one they
  // just mis-attached. The RPC's own authorisation block is the real gate —
  // it deliberately admits crew too.
  const handleRemove = (manifestId: string) => {
    removeMut.mutate(
      { routeId: route.id, manifestId },
      {
        onSuccess: () => toast.success('Carga quitada de la ruta'),
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

  // pb-40 (160px), not pb-24: the fixed bar at the foot of this screen now
  // carries TWO 40px buttons plus p-4/sm:p-6 padding -- ~112px on a phone,
  // ~128px at `sm`. pb-24 reserved 96px, so the leader (the only person who
  // sees both buttons) had the last 16-32px of the manifest list permanently
  // under the bar, on the exact screen where they check what is left to
  // collect.
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4 pb-40">
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
              <RouteManifestList
                manifests={routeManifests}
                onManifestClick={goToScan}
                // Only wired once operatorId has resolved: useRemoveManifestFromRoute
                // keys its cache invalidation off it, and a null operatorId
                // would invalidate queries that match nothing (a trait it
                // shares with useAddManifestToRoute / useCancelPickupRoute).
                onRemove={operatorId ? handleRemove : undefined}
                isRemoving={removeMut.isPending}
              />
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
        {/* space-y-3: "Cancelar ruta" is destructive and sits directly under
            the routine "Cerrar ruta y entregar". Flush, they are two
            full-width 40px targets one thumb-width apart on a phone held
            one-handed, with only the confirm dialog between a mis-tap and
            detaching every manifest on the route. 3h already separates them
            (`flex flex-col gap-4`); this surface did not. */}
        <div className="max-w-2xl mx-auto space-y-3">
          <CloseRouteButton
            totalVerified={totalVerified}
            isSubmitting={closeMut.isPending}
            onClose={handleClose}
          />
          {/* spec-61 Task 5 — the exit for a route that should not have been
              opened. Task 7 stopped offering routed loads to anyone else, so
              without this the loads sit locked to an abandoned route until
              someone opens psql.

              Only the route's own LEADER sees it: `driver_id` is the leader,
              and a crew member cancelling the trip out from under everyone
              is not a thing this spec grants. `!!userId` first — comparing
              two undefineds would read as "this is my route".

              Defence in depth, not the only gate: cancel_pickup_route
              enforces the same rule server-side since migration
              20260821000001 (driver, or an elevated role). See
              useCancelPickupRoute.ts. */}
          {!!userId && route.driver_id === userId && (
            <CancelRouteButton
              routeId={route.id}
              operatorId={operatorId}
              onCancelled={() => router.push('/app/pickup')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
