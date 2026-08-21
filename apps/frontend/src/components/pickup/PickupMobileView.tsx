'use client';

import { PickupMobileActiveRoute } from './PickupMobileActiveRoute';
import { PickupMobileHeader } from './PickupMobileHeader';
import { PickupMobileStartRoute } from './PickupMobileStartRoute';
import { PickupMobileNoRoute } from './PickupMobileNoRoute';
import { canLeadPickupRoute } from '@/lib/permissions';
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
  /** The JWT role claim (GlobalContext.tsx:53). Decides 3j vs the crew
   *  screen — a picker promoted to pickup_leader keeps seeing the crew
   *  screen until their token refreshes, which is a re-login. */
  role: string | null;
  /** The signed-in user, so the leader is never offered to themselves as
   *  crew on 3j. */
  currentUserId: string | null;
  /** True when `useActivePickupRoute` FAILED. Not the same as "no route":
   *  see the branch below. */
  routeUnknown?: boolean;
  onRetryRoute?: () => void;
  /** spec-61 Task 5 — true only for the active route's own leader; gates
   *  the cancel affordance on 3h. */
  canCancelRoute?: boolean;
  onCreateRoute: (vehicleId: string, crewIds: string[]) => void;
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
  role,
  currentUserId,
  routeUnknown = false,
  onRetryRoute,
  canCancelRoute = false,
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
        operatorId={operatorId}
        canCancelRoute={canCancelRoute}
      />
    );
  }

  // spec-61 Task 5 — 3j is the LEADER's screen. A crew member with no route
  // gets PickupMobileNoRoute instead: `start_pickup_route` refuses them by
  // role (migration 20260820000003), so rendering the vehicle picker and the
  // start button would be offering a control that can only fail.
  //
  // ONE crew screen, not two. A picker whose seat was released by a route
  // reopen lands on exactly this branch with no distinct message — spec-61,
  // "DECIDED 2026-08-21 — no signal": the recovery action is identical
  // either way, so there is nothing to branch on.
  const canLead = canLeadPickupRoute(role);

  return (
    <div className="flex flex-col gap-4" data-testid="pickup-mobile-view">
      {/* No `routeCode`: there is no route yet. `driverName` now comes from
          `useCurrentUserName` (review fix) — `PickupMobileHeader` still
          handles `null` cleanly (falls back to "··" in the avatar, omits
          the name segment) for the brief window before that query
          resolves, rather than fabricating a name. */}
      <PickupMobileHeader driverName={currentUserName ?? null} routeCode={null} />

      {/* spec-61 Task 5 — a FAILED lookup is not an empty one. After React
          Query exhausts its retries, `data` is undefined and this component
          cannot tell "you have no route" from "we could not ask". Falling
          through to 3j told a leader who HAS an open route that they do not,
          and invited them to open a second. Offer the retry instead — the
          same fix Task 4 made on route/active/page.tsx. Checked before the
          role branch because it is true for leader and crew alike. */}
      {routeUnknown ? (
        <section className="rounded-[10px] border border-border bg-surface p-5 text-center">
          <p className="text-[13px] text-text">No pudimos cargar tu ruta.</p>
          <button
            type="button"
            onClick={onRetryRoute}
            className="mt-3 min-h-[44px] w-full rounded-[10px] border border-border bg-surface-raised text-[13.5px] font-medium text-text active:opacity-90"
          >
            Reintentar
          </button>
        </section>
      ) : !canLead ? (
        <PickupMobileNoRoute />
      ) : (
        <PickupMobileStartRoute
          operatorId={operatorId}
          currentUserId={currentUserId}
          pendingRows={pendingRows}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          selectedManifests={selectedManifests}
          onCreateRoute={onCreateRoute}
          isCreatingRoute={isCreatingRoute}
          createRouteError={createRouteError}
        />
      )}
    </div>
  );
}
