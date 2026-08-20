'use client';

import { PickupMobileActiveRoute } from './PickupMobileActiveRoute';
import { PickupMobileHeader } from './PickupMobileHeader';
import { PickupMobileStartRoute } from './PickupMobileStartRoute';
import { useCurrentUserName } from '@/hooks/useCurrentUserName';
import type { ManifestRow } from './ManifestTable';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-54 mocks 3h/3j — the mobile Recogida screen.
 *
 * Rendered below the `lg` breakpoint instead of the desktop `1l` two-column
 * screen (`PickupPage` picks one or the other — see page.tsx). The
 * page-level `<h1>Recogida</h1>` header in page.tsx is gated to desktop
 * only (`!isBelowLg`) for the same reason: this screen renders its OWN
 * header (`PickupMobileHeader`, shared below), and both together would
 * stack two headers on one phone screen.
 *
 * `3h` and `3j` are mutually exclusive states of the same screen, enforced
 * by the DB (`uniq_pickup_routes_one_active_per_driver` allows one
 * draft/in_progress route per driver):
 *   - No active route → `3j` (`PickupMobileStartRoute`): a vehicle picker +
 *     "Iniciar ruta de recogida", then the operator's pending manifests
 *     grouped Cliente → Punto → Manifiesto for pre-selection into the new
 *     route. See PickupMobileStartRoute.tsx for the `assigned_to_user_id`
 *     decision this branch had to make.
 *   - Active route → `3h` (`PickupMobileActiveRoute`): header with driver +
 *     route code, three KPI tiles, a hero "next load" card, then the
 *     remaining/completed loads as compact rows, then footer actions.
 *
 * Deliberately omitted from the active-route redesign — see the spec-54
 * handoff for 3h:
 *   - The download banner ("2 de 4 cargas guardadas… Descargar"), the
 *     per-card "SIN DESCARGAR" badge, and the "Manifiesto descargado"
 *     line. All three describe a client-side offline manifest cache that
 *     exists in NEITHER app: the web app (this file) has no manifest
 *     store, and the Expo app's `apps/mobile/lib/storage.ts` persists only
 *     the UI language. The handoff itself assigns this to the mobile team.
 *   - "Reportar problema" (footer) — see PickupMobileFooterActions.
 *   - A stop-sequence / position number on the hero card. `manifests`
 *     hangs off `pickup_routes` by FK only — no `sequence`/`stop_order`
 *     column — so "next" is derived by `splitLoads` (first not-yet-
 *     finished load in queue order) and the badge reads "SIGUIENTE", a
 *     status, never a position.
 */

interface PickupMobileViewProps {
  activeRoute: ActivePickupRoute | null;
  /** Manifests already linked to the active route (useRouteManifests). */
  activeManifests: RouteManifestRow[];
  /** Manifests not yet on a route (usePendingManifests, already mapped by
   *  the page into the shared ManifestRow shape used by ManifestTable). */
  pendingRows: ManifestRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  selectedManifests: ManifestRow[];
  onOpenRouteManifest: (loadId: string) => void;
  operatorId: string | null;
  onCreateRoute: (vehicleId: string) => void;
  isCreatingRoute: boolean;
  /** start_pickup_route's error message, already a readable Spanish string
   *  raised by the RPC (e.g. the one-active-route-per-driver case) — see
   *  PickupMobileStartRoute.tsx. */
  createRouteError?: string | null;
}

export function PickupMobileView({
  activeRoute,
  activeManifests,
  pendingRows,
  selectedIds,
  onToggleSelect,
  selectedManifests,
  onOpenRouteManifest,
  operatorId,
  onCreateRoute,
  isCreatingRoute,
  createRouteError = null,
}: PickupMobileViewProps) {
  // Called unconditionally (rules of hooks) even though only the 3j return
  // below uses it — 3h already gets the driver's name from
  // `useActivePickupRoute`'s `driver:users(full_name)` join, which needs an
  // active route to exist. This is the one source that works before that.
  const { data: currentUserName } = useCurrentUserName();

  if (activeRoute) {
    return (
      <PickupMobileActiveRoute
        activeRoute={activeRoute}
        activeManifests={activeManifests}
        onOpenRouteManifest={onOpenRouteManifest}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="pickup-mobile-view">
      {/* No `routeCode`: there is no route yet. `driverName` now comes from
          `useCurrentUserName` (review fix) — `PickupMobileHeader` still
          handles `null` cleanly (falls back to "··" in the avatar, omits
          the name segment) for the brief window before that query
          resolves, rather than fabricating a name. */}
      <PickupMobileHeader driverName={currentUserName ?? null} routeCode={null} />

      <PickupMobileStartRoute
        operatorId={operatorId}
        pendingRows={pendingRows}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        selectedManifests={selectedManifests}
        onCreateRoute={onCreateRoute}
        isCreatingRoute={isCreatingRoute}
        createRouteError={createRouteError}
      />
    </div>
  );
}
