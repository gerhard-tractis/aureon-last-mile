'use client';

import { useEffect, useState } from 'react';
import { StatTile } from '@/components/StatTile';
import { ClientFilter, type ClientCount } from '@/components/pickup/ClientFilter';
import { ActiveRouteBanner } from '@/components/pickup/ActiveRouteBanner';
import { ManifestTable, type ManifestRow } from '@/components/pickup/ManifestTable';
import { RoutedManifestTable } from '@/components/pickup/RoutedManifestTable';
import { ManifestListFooter } from '@/components/pickup/ManifestListFooter';
import { ManifestSearchBar } from '@/components/pickup/ManifestSearchBar';
import { PickupRouteDraftPanel } from '@/components/pickup/PickupRouteDraftPanel';
import { TodayClosuresPanel } from '@/components/pickup/TodayClosuresPanel';
import type { ClosureRow } from '@/hooks/pickup/pickupSummary';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4.4 — Recogida, escritorio (mock 1l).
 *
 * Extracted verbatim out of `page.tsx` (same JSX, same props, same tests —
 * see `page.test.tsx`) so the `lg`-and-above tree stays byte-for-byte what
 * it was before spec-54's mobile (3h) work, and `page.tsx` stays under the
 * file-size guideline with two view trees in it.
 *
 * Two columns: the manifests to collect on the left, the route being
 * assembled and today's closures on the right. Below 1280px (`xl`) they
 * stack.
 *
 * spec-94 fase 2 — a fourth tab, `routed` ("En punto de retiro", cubo 2:
 * a manifest on a live pickup route that has not yet left for the hub).
 * The four `TabKey`s went through a map/switch, not a ternary chain — a
 * ternary silently routes a new key to its final `else` branch with no
 * compiler error (spec-94 fase 1's review: `rowsForTab` in page.tsx was
 * exactly this trap, and would have shown the routed tab's rows under the
 * OLD "Completados" label).
 *
 * Not rendered, because the data does not exist:
 *   - the pickup window column and the urgency it colours rows by
 *     (get_pending_manifests returns no window)
 *   - "cierre de retiros 18:00" in the subtitle, for the same reason
 *   - estimated vehicle occupancy (no capacity on `vehicles`, no volume on
 *     `packages`)
 */

export const TABS = [
  { key: 'pending', label: 'Por retirar' },
  { key: 'routed', label: 'En punto de retiro' },
  { key: 'in_transit', label: 'Camino a bodega' },
  { key: 'completed', label: 'En bodega' },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

const EMPTY_MESSAGES: Record<TabKey, string> = {
  pending: 'No hay manifiestos pendientes de retiro.',
  routed: 'Ninguna carga en punto de retiro.',
  in_transit: 'Ningún manifiesto en tránsito.',
  completed: 'Ningún manifiesto completado todavía.',
};

// spec-95 fase 8 (mock 5a:216-217) — "Mostrando 7 de 12 · Cargar más"
// replaces the Anterior/Siguiente pager spec-83 fase 4 found nowhere in the
// code (it was never built). This reveals more of the already-fetched rows
// client-side — there is no server-side page to ask for — 7 to match the
// mock's own first page.
const PAGE_SIZE = 7;

interface PickupDesktopViewProps {
  activeRoute: ActivePickupRoute | null | undefined;
  activeManifests: RouteManifestRow[];
  totals: { manifests: number; orders: number; packages: number };
  closures: ClosureRow[];
  clients: ClientCount[];
  selectedClient: string | null;
  setSelectedClient: (client: string | null) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  pendingRows: ManifestRow[];
  /** Unfiltered — feeds the tab button's own count, same as the other three. */
  routedRows: RoutedManifest[];
  /** Filtered by search term + selected client — what RoutedManifestTable
   *  actually renders when the routed tab is active. */
  visibleRoutedRows: RoutedManifest[];
  inTransitRows: ManifestRow[];
  completedRows: ManifestRow[];
  visibleRows: ManifestRow[];
  tab: TabKey;
  setTab: (t: TabKey) => void;
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  labelsEnabled: boolean;
  onPrintLabels: (manifestId: string) => void;
  onOpen: (row: ManifestRow) => void;
  operatorId: string | null;
  selectedManifests: ManifestRow[];
  /**
   * Desktop never sends a crew — `1l` has no crew picker, and
   * `handleCreateRoute` defaults the argument. spec-61 Task 5. `viewQr`
   * (spec-95 fase 8) is forwarded from `PickupRouteDraftPanel`'s
   * `StartRouteButton` when the driver used "Ver QR de la ruta".
   */
  onCreateRoute: (vehicleId: string, viewQr?: boolean) => void;
  isCreatingRoute: boolean;
  /** spec-61 — false for a pickup_crew user; gates `1l`'s own start
   *  affordance the same way 3j is gated. */
  canLead?: boolean;
  /** spec-61 — true when the active-route lookup FAILED. */
  routeUnknown?: boolean;
  /** spec-61 — true while the JWT claims are still resolving. */
  roleUnknown?: boolean;
}

export function PickupDesktopView({
  activeRoute,
  activeManifests,
  totals,
  closures,
  clients,
  selectedClient,
  setSelectedClient,
  searchTerm,
  setSearchTerm,
  pendingRows,
  routedRows,
  visibleRoutedRows,
  inTransitRows,
  completedRows,
  visibleRows,
  tab,
  setTab,
  selectedIds,
  toggle,
  labelsEnabled,
  onPrintLabels,
  onOpen,
  operatorId,
  selectedManifests,
  onCreateRoute,
  isCreatingRoute,
  canLead = true,
  routeUnknown = false,
  roleUnknown = false,
}: PickupDesktopViewProps) {
  const countForTab: Record<TabKey, number> = {
    pending: pendingRows.length,
    routed: routedRows.length,
    in_transit: inTransitRows.length,
    completed: completedRows.length,
  };

  // spec-95 fase 8 — "Cargar más" grows this; switching tab, searching or
  // picking a client resets it, or the ninth row of a brand-new filter
  // would render as if it had already been revealed by a click nobody made.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [tab, searchTerm, selectedClient]);

  const totalForTab = tab === 'routed' ? visibleRoutedRows.length : visibleRows.length;
  const shownCount = Math.min(visibleCount, totalForTab);
  const pagedRows = visibleRows.slice(0, visibleCount);
  const pagedRoutedRows = visibleRoutedRows.slice(0, visibleCount);

  return (
    <div className="grid min-h-0 gap-4 xl:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {activeRoute && (
          <ActiveRouteBanner
            code={activeRoute.code}
            startedAt={activeRoute.started_at}
            manifestCount={activeManifests.length}
            routeId={activeRoute.id}
          />
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Manifiestos pendientes" value={totals.manifests} />
          <StatTile label="Órdenes" value={totals.orders} />
          <StatTile label="Paquetes totales" value={totals.packages} />
          <StatTile label="Completados hoy" value={closures.length} tone="success" />
        </div>

        <ManifestSearchBar value={searchTerm} onChange={setSearchTerm} />

        {clients.length > 0 && (
          <ClientFilter clients={clients} selected={selectedClient} onSelect={setSelectedClient} />
        )}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
          <div className="flex flex-none flex-wrap items-center gap-1 border-b border-border px-4 py-2.5">
            {TABS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={tab === option.key}
                onClick={() => setTab(option.key)}
                className={cn(
                  'rounded-[7px] px-3 py-1.5 text-[11.5px] leading-none transition-colors',
                  tab === option.key
                    ? 'bg-surface-raised font-semibold text-text'
                    : 'text-text-secondary hover:bg-surface-raised',
                )}
              >
                {option.label} · {countForTab[option.key]}
              </button>
            ))}
            {tab === 'pending' && (
              <span className="ml-auto hidden text-[11px] text-text-muted lg:inline">
                Marca los manifiestos y agrégalos a una ruta de recogida
              </span>
            )}
          </div>

          {(() => {
            // ronda 4 (review fase 2): a `switch` with the FOUR TabKeys
            // written out individually, not `tab === 'routed' ? … : …`
            // wrapping the other three — a ternary here is exactly the
            // trap this file's own header comment warns about, and a
            // fifth tab added later would fall through to whichever
            // branch happens to be the ternary's `else` with tsc staying
            // silent. Exhaustive over TabKey: dropping a case makes this
            // arrow function fail to return on every path (TS2366).
            switch (tab) {
              case 'routed':
                return <RoutedManifestTable rows={pagedRoutedRows} emptyMessage={EMPTY_MESSAGES.routed} />;
              case 'pending':
                return (
                  <ManifestTable
                    rows={pagedRows}
                    selectedIds={selectedIds}
                    onToggle={toggle}
                    labelsEnabled={labelsEnabled}
                    onPrintLabels={onPrintLabels}
                    onOpen={onOpen}
                    emptyMessage={EMPTY_MESSAGES.pending}
                  />
                );
              case 'in_transit':
                return (
                  <ManifestTable
                    rows={pagedRows}
                    labelsEnabled={labelsEnabled}
                    onPrintLabels={onPrintLabels}
                    onOpen={onOpen}
                    emptyMessage={EMPTY_MESSAGES.in_transit}
                  />
                );
              case 'completed':
                return (
                  <ManifestTable
                    rows={pagedRows}
                    labelsEnabled={labelsEnabled}
                    onPrintLabels={onPrintLabels}
                    onOpen={onOpen}
                    emptyMessage={EMPTY_MESSAGES.completed}
                  />
                );
            }
          })()}

          <ManifestListFooter
            shownCount={shownCount}
            totalCount={totalForTab}
            onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
          />
        </section>
      </div>

      <aside className="flex min-h-0 flex-col gap-4">
        <PickupRouteDraftPanel
          operatorId={operatorId}
          selected={selectedManifests}
          onRemove={toggle}
          onCreate={onCreateRoute}
          isCreating={isCreatingRoute}
          activeRouteCode={activeRoute?.code ?? null}
          canLead={canLead}
          routeUnknown={routeUnknown}
          roleUnknown={roleUnknown}
        />
        <TodayClosuresPanel rows={closures} />
      </aside>
    </div>
  );
}
