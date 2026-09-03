'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsBelowLg } from '@/hooks/useViewport';
import { useRouteLoadBrief } from '@/hooks/dispatch/mobile/useRouteLoadBrief';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import { DispatchRouteBeforeScan } from './mobile/DispatchRouteBeforeScan';
import { DispatchVehicleAssignmentSheet } from './mobile/DispatchVehicleAssignmentSheet';
import { RouteBuilder } from './RouteBuilder';
import type { FleetVehicle } from '@/lib/dispatch/types';

// spec-76 review C1 — 2e (scan loop, task 4) still doesn't exist on this
// branch. 2d (this task) does now, so only the scan CTA keeps a disabled
// reason; a live-looking 56px primary button that silently does nothing
// is still the thing being avoided here, just for one CTA instead of two.
const SCAN_NOT_READY_REASON = 'El escaneo llega en el próximo paso';

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
  // Only fetched below `lg` — enabled gates the fetch itself, not just the
  // render, so a desktop session's SETTLED render never triggers this query
  // (see the doc comment above on the one transient exception).
  const {
    data: loadBrief,
    isLoading: loadBriefLoading,
    isError: loadBriefError,
    refetch: refetchLoadBrief,
  } = useRouteLoadBrief(routeId, operatorId, { enabled: isBelowLg });

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
          onStartScanning={() => {}}
          onAssignVehicle={() => setAssignSheetOpen(true)}
          startScanningDisabledReason={SCAN_NOT_READY_REASON}
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

  return <RouteBuilder routeId={routeId} operatorId={operatorId} vehicles={vehicles} />;
}
