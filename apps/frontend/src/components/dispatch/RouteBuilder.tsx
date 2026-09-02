'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { ScanZone } from './ScanZone';
import { PackageRow } from './PackageRow';
import { RoutePanel } from './RoutePanel';
import { RouteBlockList } from './RouteBlockList';
import { TopupSuggestions } from './TopupSuggestions';
import { VehicleCapacityBar } from './VehicleCapacityBar';
import { getVehicleFillStatus, type VehicleFillStatus } from '@/lib/dispatch/vehicle-capacity';
import { useScanPackage } from '@/hooks/dispatch/useScanPackage';
import { useRoutePackages } from '@/hooks/dispatch/useRoutePackages';
import { useDispatchRoute } from '@/hooks/dispatch/useDispatchRoute';
import { useRefreshRouteStatus } from '@/hooks/dispatch/useRefreshRouteStatus';
import { useRouteBlocks } from '@/hooks/dispatch/useRouteBlocks';
import { useRouteTerritoryHistory } from '@/hooks/dispatch/useRouteTerritoryHistory';
import { useDriverPrefill } from '@/hooks/dispatch/useDriverPrefill';
import { useOperatorId } from '@/hooks/useOperatorId';
import { LOADABLE_ROUTE_STATUSES, type FleetVehicle } from '@/lib/dispatch/types';
import { ROUTE_STATUS_CONFIG } from '@/lib/dispatch/route-status-labels';
import { formatRouteHeaderDate } from '@/lib/utils/dateFormat';

interface Props {
  routeId: string;
  operatorId: string;
  vehicles: FleetVehicle[];
}

export function RouteBuilder({ routeId, operatorId, vehicles }: Props) {
  const router = useRouter();
  // spec-73 phase 4b — TopupSuggestions' own role gate. GlobalContext, not
  // the `operatorId` prop (that one is passed in from the server page and
  // carries no role); same source DockZoneAdjacencySettingsPage reads.
  const { role } = useOperatorId();
  const [scanError, setScanError] = useState<string | null>(null);
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
  // affordance below (badge, scan zone, seal, dispatch) derives from.
  const { data: route } = useDispatchRoute(routeId, operatorId);
  // Every mutation below changes routes.status server-side. Refreshing the
  // packages list alone left the UI rendering the pre-mutation status — a
  // sealed route still offering "Cerrar ruta" and still refusing to enable
  // Despachar, with no way for the operator to tell anything had happened.
  const refreshRouteStatus = useRefreshRouteStatus(routeId, operatorId);
  const routeStatus = route?.status;
  const canLoad = routeStatus != null && (LOADABLE_ROUTE_STATUSES as readonly string[]).includes(routeStatus);
  const statusConfig = routeStatus ? ROUTE_STATUS_CONFIG[routeStatus] : undefined;

  const scanMutation = useScanPackage(routeId, operatorId);

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

  // spec-70 decision 4: shown live while loading, not just discovered when
  // /seal refuses — the cutoff is the worst possible moment to find out a
  // stop was never scanned.
  //
  // spec-74 phase 3 widened this to also count `partially_staged` orders
  // (an order with one bulto on the truck and one still on the andén is not
  // done either, and /seal now refuses it exactly like a fully-planned stop
  // — seal-route.ts's widened UNSEALED_STOPS). Phase 4: the unit counted is
  // now the outstanding BOX (boxesTotal - boxesLoaded), not the order. A
  // 3-bulto order with one box scanned used to read "1 stop" (one order =
  // one unit); it now reads "2" — the boxes actually still on the dock.
  //
  // spec-74 phase 4 review item 1 (BLOCKER). `adopted` was missing here, so
  // an adopted order with an unloaded sibling box contributed 0 — the
  // screen showed the route as fully staged while seal-route.ts refuses it
  // (it checks an adopted order's live packages directly, since
  // `dispatches.stage` on an adopted row is never rewritten to
  // `partially_staged`/`staged` — see seal-route.ts's own comment on that).
  // `boxesTotal`/`boxesLoaded` are now pre-filtered to the seal's own
  // DISPATCHABLE_STATUSES predicate (useRoutePackages.ts, item 3), so
  // summing `boxesTotal - boxesLoaded` for `adopted` rows too reproduces the
  // seal's adopted-completeness check exactly — a fully-loaded `adopted`
  // order still contributes 0 on its own, no separate branch needed.
  const pendingCount = packages
    .filter((p) => p.stage === 'planned' || p.stage === 'partially_staged' || p.stage === 'adopted')
    // No Math.max(..., 0) clamp (spec-74 phase 4 review M2): boxesLoaded can
    // never exceed boxesTotal — useRoutePackages.ts derives both together
    // from the same per-package loop (loaded only increments alongside
    // total), and its item-2 floor only ever raises total, never lowers it.
    // A clamp here would guard a case the data cannot produce.
    .reduce((sum, p) => sum + (p.boxesTotal - p.boxesLoaded), 0);

  // spec-73 phase 4c — the vehicle fill bar's two inputs.
  //
  // Package count: the route's total bultos (Decision 1's "package count",
  // distinct from the "Órdenes" count elsewhere on this screen), not order
  // count — capacity_packages is a bulto capacity, and a route with few
  // multi-bulto orders would otherwise read as far emptier than it is.
  // Reuses `packages` (already fetched by useRoutePackages above) rather
  // than adding a query.
  //
  // Vehicle identity: `selectedVehicle` (this component's own useState) is
  // the ONLY vehicle identity available here. `routes.vehicle_id` is NULL
  // for every route at this point in the flow — its one local writer is the
  // dispatch handler, which runs after sealing, and DispatchTrack's webhook
  // only back-fills it after dispatch (spec-73's phase-2 dependency note,
  // confirmed against the current codebase, not assumed). Before a manager
  // picks a truck, `selectedVehicle` is `''`, no `vehicles` row matches, and
  // `capacityPackages` below is `null` — `getVehicleFillStatus` returns
  // `configured: false` for that, and `VehicleCapacityBar` renders nothing,
  // never a bar pinned at 0%.
  //
  // Phase-4c review item 1. The count is only honest once `useRoutePackages`
  // has actually succeeded. `packages` defaults to `[]` while the query is
  // loading AND when it has failed, and an empty array sums to a package
  // count of 0 that is indistinguishable from a genuinely empty route — so a
  // failed read would paint "0 / 40 · Bajo cupo · 0%" on a truck that is in
  // fact full, with TopupSuggestions directly below urging the manager to add
  // MORE work to it. Same failure shape as the phase-4 blocks finding above
  // (a failed read masquerading as a real zero), and the exact "never a bar
  // pinned at 0%" state vehicle-capacity.ts's header forbids. Until the read
  // succeeds the status is the unconfigured variant, which
  // `VehicleCapacityBar` renders as nothing at all.
  const totalPackageCount = packages.reduce((sum, p) => sum + p.boxesTotal, 0);
  const selectedVehicleRecord = vehicles.find((v) => v.external_vehicle_id === selectedVehicle);
  const vehicleFillStatus: VehicleFillStatus = packagesLoaded
    ? getVehicleFillStatus(totalPackageCount, selectedVehicleRecord?.capacity_packages ?? null)
    : { configured: false, packageCount: 0 };

  const handleScan = async (code: string) => {
    setScanError(null);
    try {
      await scanMutation.mutateAsync(code);
      // QA finding #3: a seal refusal ("Faltan 2 parada(s)...") stayed on
      // screen after a scan lowered the live count to 1 — the banner named a
      // shortfall that no longer existed. A successful scan can only move a
      // stop toward staged, so any prior refusal it names is now stale.
      setSealError(null);
      await refetch();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setScanError(e.message ?? 'Error al escanear');
    }
  };

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
      {/* Left panel */}
      <div className="flex-1 flex flex-col overflow-hidden md:border-r border-border">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 h-14 bg-surface border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/app/dispatch')}
            className="text-text-muted"
          >
            <ArrowLeft />
          </Button>
          <span className="font-mono text-[15px] font-bold text-accent">
            {routeId.slice(0, 8).toUpperCase()}
          </span>
          {/* QA finding #1: this rendered today's date via `new Date()`, not
              the route's own — a route dated 2026-08-26 showed "jue, 27 ago".
              `route` is still undefined on first paint, so show nothing
              rather than guess; a wrong date is worse than a blank one. */}
          {route?.route_date && (
            <span className="text-xs text-text-muted">
              {formatRouteHeaderDate(route.route_date)}
            </span>
          )}
          {statusConfig && (
            <StatusBadge
              status={routeStatus!}
              label={statusConfig.label}
              variant={statusConfig.variant}
              size="sm"
            />
          )}
        </div>

        <ScanZone onScan={handleScan} disabled={!canLoad} lastError={scanError} />

        {/* Order count bar. spec-70 phase 4, breakage #8: these rows are
            orders planned/staged onto the route, not scanned packages — see
            useRoutePackages.ts. */}
        <div className="shrink-0 flex items-center justify-between px-5 h-9 bg-background border-b border-border">
          <span className="text-[11px] text-text-muted uppercase tracking-[0.06em]">
            Órdenes en la ruta
          </span>
          <span className="flex items-center gap-3">
            {pendingCount > 0 && (
              // spec-74 phase 4 review item 4. This bar counts orders
              // (packages.length, next to it) but this banner counts
              // outstanding BOXES — a different unit sharing one row, and
              // the seal's own refusal banner below counts STOPS. Naming
              // the unit here disambiguates all three.
              <span className="text-[11px] font-semibold text-status-warning-text">
                Faltan {pendingCount} bulto{pendingCount === 1 ? '' : 's'} por estibar
              </span>
            )}
            <strong className="font-mono text-[13px] text-accent">
              {packages.length}
            </strong>
          </span>
        </div>

        <RouteBlockList routeId={routeId} operatorId={operatorId} routeStatus={routeStatus} />

        {/* spec-73 phase 4c — the fill bar phase 4b's TopupSuggestions was
            placed next to but never wired. Answers "why would you [top
            up]?" immediately above the suggestions that answer "which
            block could you". Renders nothing until a vehicle is selected
            and that vehicle has a configured capacity_packages — see
            VehicleCapacityBar's own render-nothing contract, preserved
            here by construction (vehicleFillStatus above). */}
        <VehicleCapacityBar status={vehicleFillStatus} className="px-5 py-2" />

        {/* spec-73 phase 4b — sits directly below the block sequence,
            above the package list, next to the under-fill signal (Decision
            1's fill bar, wired in phase 4c immediately above) that
            motivates it. Renders nothing when there is nothing eligible to
            suggest — see the component's own render-nothing contract. */}
        <TopupSuggestions routeId={routeId} operatorId={operatorId} role={role} />

        {sealError && (
          <div className="shrink-0 bg-status-error-bg border-b border-status-error-border text-status-error px-5 py-2.5 text-xs">
            ⚠ {sealError}
          </div>
        )}

        {removeError && (
          <div className="shrink-0 bg-status-error-bg border-b border-status-error-border text-status-error px-5 py-2.5 text-xs">
            ⚠ {removeError}
          </div>
        )}

        {/* Package list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {packages.map((pkg, i) => (
            <PackageRow key={pkg.dispatch_id} index={i + 1} pkg={pkg} onRemove={handleRemove} />
          ))}
        </div>
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
