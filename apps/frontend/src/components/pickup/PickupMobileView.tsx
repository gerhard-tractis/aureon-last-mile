'use client';

import { PackageSearch } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PickupMobileManifestCard, type CardStatusTone } from './PickupMobileManifestCard';
import { PickupRouteDraftPanel } from './PickupRouteDraftPanel';
import type { ManifestRow } from './ManifestTable';
import type { RouteManifestRow, ManifestStatus } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-54 mock 3h — "Recogidas del día", móvil (estado inicial).
 *
 * Rendered below the `lg` breakpoint instead of the desktop `1l` two-column
 * screen (`PickupPage` picks one or the other — see page.tsx). Cards, not a
 * table: the desktop `ManifestTable` uses fixed pixel columns that wrap
 * "PUNTO DE RECOGIDA" onto two lines at phone widths.
 *
 * Deliberately omitted — see the spec-54 handoff for 3h:
 *   - "2 de 4 cargas guardadas" and a per-card "SIN DESCARGAR" chip. Both
 *     describe a client-side manifest cache. Neither app has one: the web
 *     app (this file) has no offline manifest store, and the Expo app's
 *     `apps/mobile/lib/storage.ts` today persists only the UI language.
 *     Rendering either would be inventing state no data layer holds.
 *   - A stop sequence / position number on the card. `manifests` hangs off
 *     `pickup_routes` by FK only — no `sequence`/`stop_order` column — so
 *     cards are ordered and badged by real STATUS instead (see below).
 *
 * Also out of scope here (not in the 3h card design, and each already has
 * its own screen): search, the client filter, and per-load label printing
 * (`ManifestTable`'s spec-53 affordance) — dispatcher conveniences for a
 * warehouse desk, not a phone screen with a handful of today's loads.
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

/**
 * manifests.status → card badge.
 *
 * Round 3 review: with the pending→in_progress write restored in
 * page.tsx's handleRouteManifestOpen (via openPendingManifest), `status`
 * itself is correct again for this screen's own tap path — so is the
 * `verifiedCount` check now redundant? No: kept deliberately, because
 * `/app/pickup/route/active`'s `goToScan` (RouteManifestList,
 * NextManifestCard, UpcomingManifestList) navigates a driver into the same
 * scan flow WITHOUT ever writing `status` — that page has no equivalent of
 * openPendingManifest at all. A manifest scanned exclusively from that
 * screen can sit at 'pending' in the DB indefinitely with verified_count >
 * 0. `verifiedCount` is checked first so THIS card still shows "En
 * progreso" for that real, pre-existing case — it is always live (read
 * straight off `pickup_scans`), unlike `status`. Not papering over this
 * screen's own write path; guarding a gap in a different one.
 */
function routeStatusInfo(
  status: ManifestStatus | undefined,
  verifiedCount: number,
): { label: string; tone: CardStatusTone } {
  if (status === 'completed') return { label: 'Cerrada', tone: 'complete' };
  if (status === 'cancelled') return { label: 'Cancelada', tone: 'pending' };
  if (status === 'in_progress' || verifiedCount > 0) {
    return { label: 'En progreso', tone: 'progress' };
  }
  return { label: 'Pendiente', tone: 'pending' };
}

/** get_pending_manifests never returns a status column (these loads are, by
 *  construction, 'pending' or 'in_progress' — it excludes 'completed'), so
 *  the badge is derived from verified_count>0, the same signal ManifestTable
 *  and ManifestCard already use for their "en progreso" indicator. */
function pendingStatusInfo(verifiedCount: number | undefined): {
  label: string;
  tone: CardStatusTone;
} {
  return (verifiedCount ?? 0) > 0
    ? { label: 'En progreso', tone: 'progress' }
    : { label: 'Pendiente', tone: 'pending' };
}

const STATUS_RANK: Record<ManifestStatus, number> = {
  pending: 0,
  in_progress: 0,
  completed: 1,
  cancelled: 2,
};

/** Pending/active cards first, closed ones at the bottom — per the spec-54
 *  handoff. Stable sort: ties keep the hook's own order (created_at
 *  ascending — the route's attach queue). */
function sortByStatus(rows: RouteManifestRow[]): RouteManifestRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rankDiff = STATUS_RANK[a.row.status ?? 'pending'] - STATUS_RANK[b.row.status ?? 'pending'];
      return rankDiff !== 0 ? rankDiff : a.index - b.index;
    })
    .map(({ row }) => row);
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
    const closedCount = activeManifests.filter((m) => m.status === 'completed').length;
    const cards = sortByStatus(activeManifests);

    return (
      <div className="flex flex-col gap-4" data-testid="pickup-mobile-view">
        <header className="rounded-[10px] border border-border bg-surface p-4">
          <h2 className="font-heading text-[15px] font-semibold text-text">Recogidas del día</h2>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            Ruta <span className="font-mono font-semibold text-text">{activeRoute.code}</span> ·{' '}
            {activeManifests.length} {activeManifests.length === 1 ? 'manifiesto' : 'manifiestos'}{' '}
            · {closedCount} cerradas
          </p>
        </header>

        {cards.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="Sin manifiestos en la ruta"
            description="Agrega manifiestos desde la ruta activa para empezar a verificar."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {cards.map((m) => {
              const status = routeStatusInfo(m.status, m.verified_count);
              return (
                <PickupMobileManifestCard
                  key={m.id}
                  externalLoadId={m.external_load_id}
                  retailerName={m.retailer_name}
                  pickupLocation={m.pickup_location}
                  totalOrders={m.total_orders}
                  totalPackages={m.total_packages}
                  verifiedCount={m.verified_count}
                  statusLabel={status.label}
                  statusTone={status.tone}
                  onOpen={() => onOpenRouteManifest(m.external_load_id)}
                />
              );
            })}
          </div>
        )}
      </div>
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
