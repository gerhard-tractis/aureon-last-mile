'use client';

import { useState } from 'react';
import { PackageSearch, CheckCircle2, AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { StatTile } from '@/components/StatTile';
import { PickupMobileHeader } from './PickupMobileHeader';
import { PickupRouteCrewStrip } from './PickupRouteCrewStrip';
import { PickupMobileNextLoadCard } from './PickupMobileNextLoadCard';
import { PickupMobileCompactRow } from './PickupMobileCompactRow';
import { PickupMobileFooterActions } from './PickupMobileFooterActions';
import { CancelRouteButton } from './CancelRouteButton';
import { sumExpected } from '@/lib/pickup/manifestProgress';
import { splitLoads } from '@/lib/pickup/pickupMobileHelpers';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-54 mock 3h, active-route body — split out of PickupMobileView.tsx
 * (review round 2) purely to keep both files under the 300-line limit; no
 * behaviour change from the extraction itself.
 *
 * Header with driver + route code, three KPI tiles, a hero "next load"
 * card, then the remaining/completed loads as compact rows, then footer
 * actions. See PickupMobileView.tsx for what the redesign omits and why.
 */

function matchesQuery(m: RouteManifestRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    m.external_load_id.toLowerCase().includes(q) ||
    (m.retailer_name ?? '').toLowerCase().includes(q) ||
    (m.pickup_location ?? '').toLowerCase().includes(q)
  );
}

export function PickupMobileActiveRoute({
  activeRoute,
  activeManifests,
  onOpenRouteManifest,
  onOpenRescueManifest,
  manifestsUnknown = false,
  operatorId = null,
  canCancelRoute = false,
}: {
  activeRoute: ActivePickupRoute;
  activeManifests: RouteManifestRow[];
  onOpenRouteManifest: (loadId: string) => void;
  /**
   * spec-80 fase 2b — opens a manifest `trg_route_receptions_status_sync`
   * closed WITHOUT a signature (spec-80 fase 1's H1 rescue), straight at
   * `review/[loadId]` (fase 2's `5e` gate — a pass-through when nothing is
   * missing, which the mock builds for exactly this case). Optional and
   * falls back to `onOpenRouteManifest` — the pre-fase-2b behaviour, which
   * still reaches the same screen via `scan/[loadId]`'s "Continuar a
   * revisión" but costs the crew an extra, pointless re-scan step.
   */
  onOpenRescueManifest?: (loadId: string) => void;
  /**
   * spec-80 fase 2b — true when `useRouteManifests` has not resolved real
   * data yet (still loading, or PAUSED with no network under this repo's
   * `networkMode: 'online'` default) rather than genuinely returning zero
   * manifests. `page.tsx` collapses both into `activeManifests = []` for
   * every OTHER consumer (KPI tiles, the hero card) because an empty route
   * already renders sensibly either way — but a real signature-pending
   * manifest going invisible during a network gap would read as "nothing
   * to rescue" instead of "we don't know", so this screen needs the
   * distinction kept alive just for that one banner.
   */
  manifestsUnknown?: boolean;
  operatorId?: string | null;
  /** spec-61 Task 5 — true only for the route's own leader. */
  canCancelRoute?: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { next, remaining, completedLoads, rescueLoads } = splitLoads(activeManifests);
  const openRescueManifest = onOpenRescueManifest ?? onOpenRouteManifest;
  const { knownExpectedSum, hasUnknownExpected } = sumExpected(activeManifests);
  // manifestProgress.ts: "Partial by definition when hasUnknownExpected is
  // true — never present it alone as 'the route's total' in that case."
  // Same rule RouteProgressHeader.tsx already applies to this same sum.
  const paquetesLabel: number | string = hasUnknownExpected ? '—' : knownExpectedSum;

  // Judgement call (review round 2): search does NOT take over the screen.
  // The first draft replaced the header/KPIs/hero with a bare input, which
  // is not in the artboard — the mock's footer buttons read as secondary
  // actions below the content, not a mode switch that destroys it. Filtering
  // in place is also cheaper to undo and keeps the driver's "next load"
  // hero visible while they search for something else on the same route.
  // Only the remaining/completed compact-row lists below the hero are
  // filtered; the hero card itself is never hidden by a search, since it is
  // this screen's primary action regardless of what's being searched for.
  const searching = query.trim().length > 0;
  const filteredRemaining = searching ? remaining.filter((m) => matchesQuery(m, query)) : remaining;
  const filteredCompleted = searching
    ? completedLoads.filter((m) => matchesQuery(m, query))
    : completedLoads;
  const filteredRescue = searching
    ? rescueLoads.filter((m) => matchesQuery(m, query))
    : rescueLoads;
  // N1 (review round 3): the hero card is exempt from filtering (it never
  // disappears — see above), but it must still count as a "result" for the
  // no-results check. Without this, searching for exactly the hero load
  // showed the hero AND "Sin resultados" at the same time — the hero was on
  // screen the whole time, so there were never zero results.
  const heroMatches = next != null && matchesQuery(next, query);
  const noSearchResults =
    searching &&
    !heroMatches &&
    filteredRemaining.length === 0 &&
    filteredCompleted.length === 0 &&
    filteredRescue.length === 0;

  return (
    <div className="flex flex-col gap-4" data-testid="pickup-mobile-view">
      <PickupMobileHeader
        driverName={activeRoute.driver?.full_name ?? null}
        routeCode={activeRoute.code}
      />

      {/* spec-61 Task 6 — who is on the trip, not just who is driving.
          No extra query: `crew` arrives in the same payload as the route
          (get_my_active_pickup_route). Renders nothing on a solo route. */}
      <PickupRouteCrewStrip
        driverName={activeRoute.driver?.full_name ?? null}
        crew={activeRoute.crew}
      />

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="CARGAS" value={activeManifests.length} />
        <StatTile label="PAQUETES" value={paquetesLabel} />
        <StatTile label="CERRADAS" value={completedLoads.length} tone="success" />
      </div>

      {manifestsUnknown ? (
        // spec-80 fase 2b — "we don't know" must never render as the same
        // thing as "the route genuinely has nothing" (see `manifestsUnknown`
        // above). Shown instead of the empty-route state below, which would
        // otherwise tell the crew there is nothing here — including nothing
        // to rescue — while the real answer is "we couldn't check".
        <div
          role="status"
          className="flex flex-col items-center gap-1 rounded-[10px] border border-status-warning-border bg-status-warning-bg px-4 py-5 text-center"
        >
          <AlertTriangle className="h-5 w-5 text-status-warning-text" aria-hidden="true" />
          <p className="text-[13px] font-medium text-status-warning-text">
            No pudimos comprobar tus cargas
          </p>
          <p className="text-[12px] text-status-warning-text">
            Revisa tu conexión — puede haber cargas pendientes de firma.
          </p>
        </div>
      ) : activeManifests.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Sin manifiestos en la ruta"
          description="Agrega manifiestos desde la ruta activa para empezar a verificar."
        />
      ) : next ? (
        <PickupMobileNextLoadCard
          manifest={next}
          onStart={() => onOpenRouteManifest(next.external_load_id)}
        />
      ) : (
        // Only reachable when the route DOES have manifests and every one
        // is finished — distinct from the empty-route case above, which
        // would otherwise falsely read as "your day is done" instead of
        // "nothing has been added yet".
        <EmptyState
          icon={CheckCircle2}
          title="Ruta completa"
          description="Todos los manifiestos de esta ruta ya fueron cerrados."
        />
      )}

      {searchOpen && (
        <input
          type="search"
          aria-label="Buscar carga"
          autoFocus
          // N6 (review round 3) — the field mounts above the compact lists
          // while its trigger sits at the bottom; on a long route it can
          // open off-screen. Scroll it into view on mount rather than
          // relying on autoFocus alone (which moves keyboard focus but not
          // the viewport on every platform).
          ref={(el) => el?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por código, cliente o punto de retiro…"
          className="min-h-[44px] w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-muted"
        />
      )}

      {noSearchResults ? (
        <EmptyState
          icon={PackageSearch}
          title="Sin resultados"
          description="Ninguna carga coincide con la búsqueda."
        />
      ) : (
        <>
          {/* spec-80 fase 2b — the mobile rescue entry. `trg_route_receptions_
              status_sync` (spec-80 fase 1) can close a manifest without ever
              routing the crew through Firma; desktop reaches it via
              Completados → escanear → revisión → firma, a tab mobile does
              not have. Rendered first (above "remaining") and unconditionally
              visible whenever one exists — a rescue is not something the
              crew should have to know to look for behind a tap, which is
              the exact discoverability gap this fase closes. */}
          {filteredRescue.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-status-error-text">
                Pendientes de firma
              </p>
              {filteredRescue.map((m) => (
                <PickupMobileCompactRow
                  key={m.id}
                  variant="needsSignature"
                  manifest={m}
                  onOpen={() => openRescueManifest(m.external_load_id)}
                />
              ))}
            </div>
          )}

          {filteredRemaining.length > 0 && (
            <div className="flex flex-col gap-2">
              {filteredRemaining.map((m) => (
                <PickupMobileCompactRow
                  key={m.id}
                  variant="remaining"
                  manifest={m}
                  onOpen={() => onOpenRouteManifest(m.external_load_id)}
                />
              ))}
            </div>
          )}

          {filteredCompleted.length > 0 && (
            <div className="flex flex-col gap-2">
              {filteredCompleted.map((m) => (
                <PickupMobileCompactRow
                  key={m.id}
                  variant="completed"
                  manifest={m}
                  onOpen={() => onOpenRouteManifest(m.external_load_id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Full width, not the mock's two-up grid. Round 2 tried the literal
          half-width slot with "Reportar problema" left empty; that read as
          a control that failed to render rather than one deliberately not
          built (no issue-report flow exists anywhere in the codebase to
          back it). Full width is less literal but reads as finished. */}
      <PickupMobileFooterActions
        searchOpen={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((open) => !open);
          if (searchOpen) setQuery('');
        }}
      />

      {/* spec-61 Task 5 — the only exit from an abandoned route that a phone
          can reach. `ActiveRouteBanner`'s "Ver ruta" link lives in
          PickupDesktopView, so below `lg` the route/active screen (where
          "Cerrar ruta" and the other copy of this control sit) is reachable
          only in the moment right after the route is created. Without this,
          a leader whose manifests all failed to attach is stuck on 3h with
          an empty route and no way back to 3j. Leader only — see page.tsx
          for the gate and its client-side-only caveat. */}
      {canCancelRoute && (
        <CancelRouteButton routeId={activeRoute.id} operatorId={operatorId} />
      )}
    </div>
  );
}
