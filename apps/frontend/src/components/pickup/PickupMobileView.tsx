'use client';

import { PackageSearch } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PickupMobileActiveRoute } from './PickupMobileActiveRoute';
import { PickupMobileManifestCard, type CardStatusTone } from './PickupMobileManifestCard';
import { PickupRouteDraftPanel } from './PickupRouteDraftPanel';
import type { ManifestRow } from './ManifestTable';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-54 mock 3h — "Recogidas de hoy", móvil.
 *
 * Rendered below the `lg` breakpoint instead of the desktop `1l` two-column
 * screen (`PickupPage` picks one or the other — see page.tsx).
 *
 * Two states:
 *   - No active route: the pre-existing pending-manifest picker + route
 *     draft panel (unrelated to the 3h mock, which only shows a driver
 *     already on a route — left as-is).
 *   - Active route (the 3h mock): header with driver + route code, three
 *     KPI tiles, a hero "next load" card, then the remaining/completed
 *     loads as compact rows, then footer actions.
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
  /** Real "closed today" count — get_completed_manifests, i.e.
   *  manifest_status_enum = 'completed'. Not the omitted client-cache
   *  "guardadas" count; a different, real figure. */
  closuresCount: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  selectedManifests: ManifestRow[];
  onOpenPending: (row: ManifestRow) => void;
  onOpenRouteManifest: (loadId: string) => void;
  operatorId: string | null;
  onCreateRoute: (vehicleId: string) => void;
  isCreatingRoute: boolean;
}

/** manifests.status → card badge, for the no-active-route pending list
 *  below (unrelated to the active-route 3h redesign above). */
function pendingStatusInfo(verifiedCount: number | undefined): {
  label: string;
  tone: CardStatusTone;
} {
  return (verifiedCount ?? 0) > 0
    ? { label: 'En progreso', tone: 'progress' }
    : { label: 'Pendiente', tone: 'pending' };
}

export function PickupMobileView({
  activeRoute,
  activeManifests,
  pendingRows,
  closuresCount,
  selectedIds,
  onToggleSelect,
  selectedManifests,
  onOpenPending,
  onOpenRouteManifest,
  operatorId,
  onCreateRoute,
  isCreatingRoute,
}: PickupMobileViewProps) {
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
      <header className="rounded-[10px] border border-border bg-surface p-4">
        <h2 className="font-heading text-[15px] font-semibold text-text">Recogidas del día</h2>
        <p className="mt-0.5 text-[12px] text-text-secondary">
          {pendingRows.length} {pendingRows.length === 1 ? 'manifiesto' : 'manifiestos'} por
          retirar · {closuresCount} {closuresCount === 1 ? 'cerrada' : 'cerradas'} hoy
        </p>
      </header>

      {pendingRows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Sin recogidas pendientes"
          description="No tienes manifiestos por retirar hoy."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {pendingRows.map((row) => {
            const status = pendingStatusInfo(row.verifiedCount);
            const selectableRow = row.id != null;
            return (
              <PickupMobileManifestCard
                key={row.externalLoadId}
                externalLoadId={row.externalLoadId}
                retailerName={row.retailerName}
                pickupLocation={row.pickupPoint}
                totalOrders={row.orderCount}
                totalPackages={row.packageCount}
                verifiedCount={row.verifiedCount ?? 0}
                statusLabel={status.label}
                statusTone={status.tone}
                selectable={selectableRow}
                selected={row.id != null && selectedIds.has(row.id)}
                onSelect={() => row.id && onToggleSelect(row.id)}
                onOpen={() => onOpenPending(row)}
              />
            );
          })}
        </div>
      )}

      {/* No `activeRouteCode` here: this branch only renders when
          `activeRoute` is null (the early return above handles the
          in-progress-route case), so the panel always offers to build a new
          route. */}
      <PickupRouteDraftPanel
        operatorId={operatorId}
        selected={selectedManifests}
        onRemove={onToggleSelect}
        onCreate={onCreateRoute}
        isCreating={isCreatingRoute}
        activeRouteCode={null}
      />
    </div>
  );
}
