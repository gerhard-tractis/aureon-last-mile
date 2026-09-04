'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoutePanel } from './RoutePanel';
import { RouteBuilderHeader } from './RouteBuilderHeader';
import { RouteBuilderPackageList } from './RouteBuilderPackageList';
import { getVehicleFillStatus, type VehicleFillStatus } from '@/lib/dispatch/vehicle-capacity';
import { useRoutePackages } from '@/hooks/dispatch/useRoutePackages';
import { useDispatchRoute } from '@/hooks/dispatch/useDispatchRoute';
import { useRefreshRouteStatus } from '@/hooks/dispatch/useRefreshRouteStatus';
import { useRouteBlocks } from '@/hooks/dispatch/useRouteBlocks';
import { useRouteTerritoryHistory } from '@/hooks/dispatch/useRouteTerritoryHistory';
import { useDriverPrefill } from '@/hooks/dispatch/useDriverPrefill';
import { useOperatorId } from '@/hooks/useOperatorId';
import { type FleetVehicle } from '@/lib/dispatch/types';
import { ROUTE_STATUS_CONFIG } from '@/lib/dispatch/route-status-labels';

interface Props {
  routeId: string;
  operatorId: string;
  vehicles: FleetVehicle[];
}

/**
 * `/app/dispatch/[routeId]` — the manager's build/assign/dispatch screen
 * for a route that is NOT currently `loading`. `DispatchRouteSurface`
 * routes a `loading` (`EN CARGA`) route to the read-only `RouteTrackingView`
 * (`1c`, spec-75 phase 4) instead: a crew is actively scanning on mobile
 * at that point and the desktop is a spectator, not a builder.
 *
 * spec-75 phase 4 — this component used to also own the scan zone
 * (`ScanZone`). That is REMOVED here, not relocated: the desktop never
 * scans again now that spec-76 shipped the crew's mobile replacement
 * (`2e`). What survives is everything about ASSEMBLING a route
 * (`draft`/`planned`), DISPATCHING an already-`loaded` one (decision 4:
 * "despachar lo puede hacer cualquiera de las tres superficies sobre una
 * ruta ya cerrada"), and — restored after a phase-4 review finding —
 * SEALING one ("Cerrar Ruta" → `POST /seal`). Sealing was briefly removed
 * on the theory that decision 4's "closing is crew-mobile only" already
 * covered it; it doesn't yet, because the mobile `2i` replacement is
 * `spec-77`, `Status: backlog`. Removing this before that ships left zero
 * callers of `POST /api/dispatch/routes/[id]/seal` — no way to close a
 * route at all. Keep it until spec-77 phase 1 lands a working mobile
 * close (see the matching comment in `RoutePanel.tsx`). Also unchanged:
 * territory stability, the vehicle fill bar, top-up suggestions, removing a
 * stop from the plan, and picking a truck/driver.
 *
 * Split along its remaining seams (header/status, package list, vehicle
 * panel) into `RouteBuilderHeader.tsx` / `RouteBuilderPackageList.tsx` /
 * `RoutePanel.tsx` to stay under the 300-line budget.
 */
export function RouteBuilder({ routeId, operatorId, vehicles }: Props) {
  const router = useRouter();
  // spec-73 phase 4b — TopupSuggestions' own role gate. GlobalContext, not
  // the `operatorId` prop (that one is passed in from the server page and
  // carries no role); same source DockZoneAdjacencySettingsPage reads.
  const { role } = useOperatorId();
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [driverName, setDriverName] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // `isSuccess` (not just `data`) — see the fill-bar block below: a failed or
  // still-loading packages read defaults `packages` to `[]`, which is
  // indistinguishable from a genuinely empty route and would otherwise render
  // as a fabricated 0% fill.
  const { data: packages = [], refetch, isSuccess: packagesLoaded } = useRoutePackages(routeId, operatorId);
  // spec-70 phase 4, breakage #3: "closed" used to live in a `useState` a page
  // reload wiped. The route's real status is fetched here and is what every
  // affordance below (badge, remove, dispatch) derives from.
  const { data: route } = useDispatchRoute(routeId, operatorId);
  // Removal below changes routes.status server-side (via the seal-refusal
  // recovery path) — refreshing the packages list alone left the UI
  // rendering the pre-mutation status.
  const refreshRouteStatus = useRefreshRouteStatus(routeId, operatorId);
  const routeStatus = route?.status;
  const statusConfig = routeStatus ? ROUTE_STATUS_CONFIG[routeStatus] : undefined;

  // spec-72 phase 4 (Decision 6) — territory stability. `useRouteBlocks` is
  // already the source RouteBlockList reads for its own orphan count; called
  // again here it shares react-query's cache under the same key (no extra
  // request), so this reuses the exact same "sin bloque" definition rather
  // than recomputing it. That orphan count is what
  // useRouteTerritoryHistory's own comuna lookup cannot see (it only knows
  // about comunas with a LIVE block) — surfaced together in RoutePanel via
  // TerritoryStability so the check's blind spot is visible, not silent.
  const { data: blockData, isError: blocksError } = useRouteBlocks(routeId, operatorId);
  // Phase-4 review item 4 (HIGH): `(blockData?.unblocked ?? []).filter(...)`
  // used to resolve to 0 on BOTH loading and error, which let a failed
  // blocks read masquerade as "0 orphans" — a complete-looking territory
  // answer with no incompleteness caveat anywhere on screen. `null` here
  // means "unknown", distinct from a genuine 0, and TerritoryStability.tsx
  // renders the two states differently.
  const territoryOrphanCount = blocksError
    ? null
    : (blockData?.unblocked ?? []).filter((u) => u.reason === 'orphan').length;
  const { data: territory = [] } = useRouteTerritoryHistory(routeId, operatorId);
  const isDriverSuggested = useDriverPrefill(territory, driverName, setDriverName);

  // spec-70 decision 4 / spec-74 phases 3-4: outstanding boxes still on the
  // dock, across planned/partially_staged/adopted orders — see
  // useRoutePackages.ts for the DISPATCHABLE_STATUSES-filtered boxesTotal/
  // boxesLoaded this sums.
  const pendingCount = packages
    .filter((p) => p.stage === 'planned' || p.stage === 'partially_staged' || p.stage === 'adopted')
    .reduce((sum, p) => sum + (p.boxesTotal - p.boxesLoaded), 0);

  // spec-73 phase 4c — the vehicle fill bar's two inputs. See
  // vehicle-capacity.ts and VehicleCapacityBar.tsx for why `configured:
  // false` (never a bar pinned at 0%) is the answer until both the packages
  // read has succeeded AND a vehicle with real capacity is selected.
  const totalPackageCount = packages.reduce((sum, p) => sum + p.boxesTotal, 0);
  const selectedVehicleRecord = vehicles.find((v) => v.external_vehicle_id === selectedVehicle);
  const vehicleFillStatus: VehicleFillStatus = packagesLoaded
    ? getVehicleFillStatus(totalPackageCount, selectedVehicleRecord?.capacity_packages ?? null)
    : { configured: false, packageCount: 0 };

  const handleRemove = async (dispatchId: string) => {
    setRemoveError(null);
    // The handler requires a non-empty reason (400 without one) — this used
    // to send no body at all, so every click 400'd silently and the trash
    // icon looked like it worked while doing nothing. A route with an order
    // that will never reach the dock then has no way to seal: the seal
    // refusal names removal as the way out, and this is that way out.
    const reason = window.prompt('Motivo para quitar esta parada de la planificación:');
    if (!reason || !reason.trim()) return;
    const res = await fetch(`/api/dispatch/routes/${routeId}/packages/${dispatchId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) {
      // QA finding #3: removing a stop is the seal refusal's own remedy — the
      // one it names ("...pide a un responsable que las quite") — so a
      // successful removal can only bring the shortfall down, never leave it
      // unchanged. Clear the stale banner rather than let it name a count
      // the live counter has already moved past.
      setSealError(null);
      await Promise.all([refetch(), refreshRouteStatus()]);
    } else {
      const json = await res.json().catch(() => ({}));
      setRemoveError(json.message ?? 'No se pudo quitar la parada');
    }
  };

  const handleClose = async () => {
    setSealError(null);
    // /seal, not the deprecated /close alias — spec-70 phase 3.
    const res = await fetch(`/api/dispatch/routes/${routeId}/seal`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      // Both, and the route one matters most: sealing moves the row to
      // `loaded`, which is what flips the badge, disables Cerrar ruta and
      // unlocks Despachar. Refreshing only the package list left every one of
      // those showing the pre-seal state.
      await Promise.all([refetch(), refreshRouteStatus()]);
    } else {
      // A refusal (e.g. UNSEALED_STOPS) used to be swallowed here, so the
      // button looked like it did nothing — this is the fix.
      setSealError(json.message ?? 'No se pudo cerrar la ruta');
    }
  };

  const handleDispatch = async () => {
    if (!selectedVehicle) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truck_identifier: selectedVehicle, driver_identifier: driverName || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Error al despachar');
      router.push('/app/dispatch');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setDispatchError(e.message ?? 'Error de DispatchTrack');
    } finally {
      setDispatching(false);
    }
  };

  const handleDelete = async () => {
    await fetch(`/api/dispatch/routes/${routeId}`, { method: 'DELETE' });
    router.push('/app/dispatch');
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-53px)] overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden md:border-r border-border">
        <RouteBuilderHeader
          routeId={routeId}
          routeDate={route?.route_date}
          routeStatus={routeStatus}
          statusConfig={statusConfig}
          pendingCount={pendingCount}
          packageCount={packages.length}
          onBack={() => router.push('/app/dispatch')}
        />

        <RouteBuilderPackageList
          routeId={routeId}
          operatorId={operatorId}
          routeStatus={routeStatus}
          role={role}
          vehicleFillStatus={vehicleFillStatus}
          sealError={sealError}
          removeError={removeError}
          packages={packages}
          onRemove={handleRemove}
        />
      </div>

      <RoutePanel
        packageCount={packages.length}
        vehicles={vehicles}
        selectedVehicle={selectedVehicle}
        driverName={driverName}
        routeStatus={routeStatus}
        dispatching={dispatching}
        dispatchError={dispatchError}
        onVehicleChange={setSelectedVehicle}
        onDriverChange={setDriverName}
        onClose={handleClose}
        onDispatch={handleDispatch}
        onRetry={handleDispatch}
        onDelete={handleDelete}
        territory={territory}
        territoryOrphanCount={territoryOrphanCount}
        isDriverSuggested={isDriverSuggested}
      />
    </div>
  );
}
