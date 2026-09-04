'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsBelowLg } from '@/hooks/useViewport';
import { useRouteLoadBrief } from '@/hooks/dispatch/mobile/useRouteLoadBrief';
import { useDispatchRoute } from '@/hooks/dispatch/useDispatchRoute';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import { DispatchRouteBeforeScan } from './mobile/DispatchRouteBeforeScan';
import { DispatchVehicleAssignmentSheet } from './mobile/DispatchVehicleAssignmentSheet';
import { DispatchRouteScanSession } from './mobile/DispatchRouteScanSession';
import { DispatchPackagesByStop } from './mobile/DispatchPackagesByStop';
import { RouteBuilder } from './RouteBuilder';
import { RouteTrackingView } from './RouteTrackingView';
import type { FleetVehicle } from '@/lib/dispatch/types';

/**
 * spec-76 decision 1 — the viewport branch for `/app/dispatch/[routeId]`,
 * kept OUT of `RouteBuilder` on purpose (spec-76 task-1 review): that file
 * was already over the 300-line budget before this task (364, spec-75
 * phase 4's split is deliberately parked until spec-76 ships) and must not
 * grow further. This thin wrapper is the one place that decides between
 * the crew mobile tree (`2c`) and the untouched desktop `RouteBuilder`.
 *
 * Returning before `RouteBuilder` mounts also means its desktop-only hooks
 * (`useRoutePackages`, `useDispatchRoute`, `useRouteBlocks`,
 * `useRouteTerritoryHistory`, `useDriverPrefill`) never run on a SETTLED
 * mobile render. spec-76 review I2 — this does NOT mean a phone fetches
 * nothing desktop-shaped, full stop: `useIsBelowLg` resolves the real
 * viewport in a post-hydration effect (`useViewport.ts`'s SSR-safe
 * default), so `isBelowLg` is `false` on the very first client render
 * regardless of device. `RouteBuilder` commits once on that first render —
 * its observers fire a real fetch round — before the effect flips
 * `isBelowLg` to `true` and this component swaps to the crew tree. One
 * transient desktop mount is unavoidable with this mechanism; what the
 * wrapper removes is every fetch AFTER that (previously every fetch, every
 * render, for the component's whole lifetime, because the branch lived
 * inside `RouteBuilder` and Rules of Hooks forced its hooks to run
 * regardless). See `DispatchRouteSurface.viewport-hydration.test.tsx`
 * (spec-76 review I3), which exercises this with the real hook rather than
 * a mock that skips it.
 *
 * spec-75 phase 4 — the desktop branch is no longer a single component.
 * `1c` (decision 4) is read-only for a route in `loading` (`EN CARGA`):
 * that is the state where a crew is actively scanning on mobile and the
 * desktop is a spectator, not a builder. `RouteBuilder` (build/assign/
 * dispatch, no scanning of its own any more — see its own header) keeps
 * every other status: `draft`/`planned` (still assembling the route) and
 * `loaded` (Despachar a DispatchTrack stays on desktop — decision 4:
 * "despachar lo puede hacer cualquiera de las tres superficies"). The
 * status read below is gated on `!isBelowLg` the same way the mobile load
 * brief above is gated on `isBelowLg` — a mobile session stops re-running
 * it once `useIsBelowLg` settles; the one transient desktop-shaped fetch
 * on first render is the same unavoidable exception documented above.
 */
export interface DispatchRouteSurfaceProps {
  routeId: string;
  operatorId: string;
  vehicles: FleetVehicle[];
}

export function DispatchRouteSurface({ routeId, operatorId, vehicles }: DispatchRouteSurfaceProps) {
  const router = useRouter();
  const isBelowLg = useIsBelowLg();
  const [assignSheetOpen, setAssignSheetOpen] = useState(false);
  // spec-76 task 3 — 2e now exists: "Empezar a escanear" switches this
  // page's own state to the scan session instead of navigating to a new
  // route, exactly like 2d's sheet does for vehicle assignment. Going back
  // is not wired (not asked for by the mock — the loop is a one-way door
  // until Cerrar ruta ships in spec-77) — nothing here regresses the state
  // once scanning starts.
  const [scanning, setScanning] = useState(false);
  // spec-76 task 4 (2h) — "Ver los N" from 2e swaps to this state instead
  // of navigating, same mechanism as `scanning`.
  //
  // spec-76 review C1 — this used to be an `if (scanning && viewingPackages)
  // return <DispatchPackagesByStop/>` / `if (scanning) return
  // <DispatchRouteScanSession/>` PAIR of mutually exclusive branches, so
  // opening 2h genuinely UNMOUNTED DispatchRouteScanSession.
  // `useRouteScanSession`'s `history`/`rejectionCount`/`rejectionTally`
  // live in `useState` inside that hook — that hook's own header says
  // outright that a rejection lives nowhere else ("this tab's own memory
  // only") — so one tap on "Ver los 148" and back wiped the crew's only
  // record of which boxes were refused. The counter alone survived
  // because it is react-query state, not local to the unmounted
  // component, which is what made this easy to miss.
  //
  // Fixed by keeping `DispatchRouteScanSession` mounted for the whole time
  // `scanning` is true, toggling the NATIVE `hidden` attribute (not a CSS
  // class) instead of conditionally rendering it: `hidden` forces
  // `display: none`, which the browser also treats as un-focusable — the
  // mounted `ScanField`/camera underneath cannot silently swallow a real
  // gun scan while 2h is showing, the way a merely off-screen (opacity/
  // transform) field could. `DispatchPackagesByStop` still mounts/unmounts
  // normally on top of it — its own state has nothing that needs to
  // survive being closed.
  const [viewingPackages, setViewingPackages] = useState(false);
  // Only fetched below `lg` — enabled gates the fetch itself, not just the
  // render, so a desktop session's SETTLED render never triggers this query
  // (see the doc comment above on the one transient exception).
  const {
    data: loadBrief,
    isLoading: loadBriefLoading,
    isError: loadBriefError,
    refetch: refetchLoadBrief,
  } = useRouteLoadBrief(routeId, operatorId, { enabled: isBelowLg });
  // Desktop-only route status read — decides RouteBuilder vs the read-only
  // 1c tracking view. Gated the mirror-image way from the mobile brief
  // above (see this file's own header comment).
  const { data: route, isLoading: routeLoading } = useDispatchRoute(routeId, operatorId, !isBelowLg);

  if (isBelowLg) {
    if (loadBriefLoading) {
      return (
        <div className="flex flex-col gap-3 p-4" data-testid="dispatch-route-surface-skeleton">
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-24 w-full rounded-[10px]" />
          <Skeleton className="h-56 w-full rounded-[10px]" />
        </div>
      );
    }
    if (loadBriefError) {
      // spec-76 review M6 — a failed read used to fall through to `?? 0`
      // fallbacks, rendering "0 / 0 / 0" that reads as a real (and
      // reassuring) empty route rather than a query that failed.
      return (
        <div className="flex flex-col items-center gap-3 p-6 text-center" data-testid="dispatch-route-surface-error">
          <p className="text-[13.5px] text-status-error-text">No pudimos cargar el resumen de la ruta.</p>
          <button
            type="button"
            onClick={() => refetchLoadBrief()}
            className="min-h-[44px] rounded-[10px] border border-border px-4 text-[13.5px] font-medium text-text active:opacity-90"
          >
            Reintentar
          </button>
        </div>
      );
    }
    if (scanning) {
      return (
        <>
          <div hidden={viewingPackages}>
            <DispatchRouteScanSession
              routeId={routeId}
              operatorId={operatorId}
              routeCode={routeCode(routeId)}
              loadPositionLabel={loadBrief?.loadPositionLabel ?? null}
              driverName={loadBrief?.vehicleAssignment?.driverName ?? null}
              vehicleExternalId={loadBrief?.vehicleAssignment?.externalVehicleId ?? null}
              onViewPackages={() => setViewingPackages(true)}
            />
          </div>
          {viewingPackages && (
            <DispatchPackagesByStop
              routeId={routeId}
              operatorId={operatorId}
              routeCode={routeCode(routeId)}
              ordersCount={loadBrief?.ordersCount ?? 0}
              stopsCount={loadBrief?.stopsCount ?? 0}
              onBack={() => setViewingPackages(false)}
            />
          )}
        </>
      );
    }
    return (
      <>
        <DispatchRouteBeforeScan
          routeCode={routeCode(routeId)}
          loadPositionLabel={loadBrief?.loadPositionLabel ?? null}
          pendingOnDock={loadBrief?.pendingOnDock ?? 0}
          ordersCount={loadBrief?.ordersCount ?? 0}
          stopsCount={loadBrief?.stopsCount ?? 0}
          vehicleAssignment={loadBrief?.vehicleAssignment ?? null}
          incompleteOrders={loadBrief?.incompleteOrders ?? []}
          comunas={loadBrief?.comunas ?? []}
          onBack={() => router.push('/app/dispatch')}
          onStartScanning={() => setScanning(true)}
          onAssignVehicle={() => setAssignSheetOpen(true)}
        />
        <DispatchVehicleAssignmentSheet
          open={assignSheetOpen}
          onOpenChange={setAssignSheetOpen}
          routeId={routeId}
          routeCode={routeCode(routeId)}
          operatorId={operatorId}
          onAssigned={() => {
            // The sheet already persisted the assignment (PATCH
            // /api/dispatch/routes/[id]); refetching here is what makes
            // 2c stop showing "Sin asignar" without a full page reload.
            refetchLoadBrief();
          }}
        />
      </>
    );
  }

  if (routeLoading) {
    return (
      <div className="flex flex-col gap-3 p-5" data-testid="dispatch-route-surface-desktop-skeleton">
        <Skeleton className="h-9 w-48 rounded-md" />
        <Skeleton className="h-24 w-full rounded-[10px]" />
        <Skeleton className="h-56 w-full rounded-[10px]" />
      </div>
    );
  }

  if (route?.status === 'loading') {
    return <RouteTrackingView routeId={routeId} operatorId={operatorId} />;
  }

  return <RouteBuilder routeId={routeId} operatorId={operatorId} vehicles={vehicles} />;
}
