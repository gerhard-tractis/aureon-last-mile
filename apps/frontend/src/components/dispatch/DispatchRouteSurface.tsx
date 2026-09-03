'use client';

import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsBelowLg } from '@/hooks/useViewport';
import { useRouteLoadBrief } from '@/hooks/dispatch/mobile/useRouteLoadBrief';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import { DispatchRouteBeforeScan } from './mobile/DispatchRouteBeforeScan';
import { RouteBuilder } from './RouteBuilder';
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
 * `useRouteTerritoryHistory`, `useDriverPrefill`) never run on mobile at
 * all — the previous in-`RouteBuilder` branch still fetched and discarded
 * them (Rules of Hooks forced them to run every render regardless); a
 * phone below `lg` now fetches nothing desktop-shaped.
 */
export interface DispatchRouteSurfaceProps {
  routeId: string;
  operatorId: string;
  vehicles: FleetVehicle[];
}

export function DispatchRouteSurface({ routeId, operatorId, vehicles }: DispatchRouteSurfaceProps) {
  const router = useRouter();
  const isBelowLg = useIsBelowLg();
  // Only fetched below `lg` — enabled gates the fetch itself, not just the
  // render, so a desktop session never triggers this query.
  const { data: loadBrief, isLoading: loadBriefLoading } = useRouteLoadBrief(routeId, operatorId, {
    enabled: isBelowLg,
  });

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
    return (
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
        // 2e (scan loop) and 2d (vehicle sheet) are spec-76 tasks 4 and 2 —
        // out of this task's scope, and neither exists yet. Documented
        // no-ops rather than routing at a URL that does not exist yet or
        // mounting the desktop ScanZone (the whole point of this branch is
        // not to do that).
        onStartScanning={() => {}}
        onAssignVehicle={() => {}}
      />
    );
  }

  return <RouteBuilder routeId={routeId} operatorId={operatorId} vehicles={vehicles} />;
}
