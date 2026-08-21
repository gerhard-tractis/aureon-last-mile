'use client';

import { useMemo, useState } from 'react';
import { Loader2, PackageSearch, Plus, Search, X } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { VehicleSelect } from './VehicleSelect';
import { CrewSelect } from './CrewSelect';
import { PickupMobileClientGroup } from './PickupMobileClientGroup';
import {
  clientSelectionState,
  groupPendingManifests,
  type StartRouteClientGroup,
} from '@/lib/pickup/pickupStartRouteGrouping';
import type { ManifestRow } from './ManifestTable';

/**
 * spec-54 mock 3j — "Sin ruta activa: iniciar ruta y sumarle manifiestos".
 * Renders below `lg` instead of 3h (`PickupMobileActiveRoute`) exactly when
 * the driver has no `in_progress` pickup route — the two are mutually
 * exclusive states of the same screen, enforced by
 * `uniq_pickup_routes_one_active_per_driver`. See PickupMobileView.tsx.
 *
 * `assigned_to_user_id` decision (must read before changing this file):
 * the mock's eyebrow says "MANIFIESTOS ASIGNADOS A TI", which would imply
 * filtering `pendingRows` by `manifests.assigned_to_user_id`. That column
 * has ZERO writers anywhere in the app (frontend, agents, worker) — grepped
 * the whole repo — and is read only once, by the one-time backfill at
 * 20260625000001_spec47…:674, which only ever COPIES a null. It is NULL on
 * every current manifest. Filtering by it would show every real driver an
 * empty screen forever. This renders the operator's real un-routed pending
 * manifests instead (exactly what the pre-3j branch this replaces did) and
 * labels the eyebrow honestly — "MANIFIESTOS POR RETIRAR" — rather than
 * claiming an assignment that does not exist. GAP: no per-driver manifest
 * assignment flow exists anywhere in this codebase; building the mock's
 * literal "asignados a ti" claim needs one, which is out of scope here.
 *
 * Already-routed manifests (review round 2, item 2): `add_manifest_to_route`
 * rejects a manifest already linked to a DIFFERENT route. This used to be
 * visible only as a toast, because `get_pending_manifests` offered routed
 * loads like any other. spec-61 Task 7 (migration 20260820000006) excludes
 * them server-side, so the rows simply are not in `pendingRows` any more —
 * no client-side filter and no `pickup_route_id` on the row shape is needed
 * or wanted here. A prior draft added a `routedElsewhereIds` prop +
 * disabled/"Ya está en otra ruta" row; `page.tsx` never had data to populate
 * it, so it was dead UI, and after Task 7 it would be permanently dead.
 * The race between two leaders loading the list at the same moment is still
 * real and still ends at `page.tsx`'s `handleCreateRoute`, which batches
 * `add_manifest_to_route` calls and toasts "La ruta se creó, pero N de M
 * manifiestos no se pudieron agregar." — that toast remains the last resort.
 */
export interface PickupMobileStartRouteProps {
  operatorId: string | null;
  /** The signed-in leader — never offered to themselves in CrewSelect. */
  currentUserId: string | null;
  pendingRows: ManifestRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  selectedManifests: ManifestRow[];
  /** spec-61: the crew rides in the SAME call as the vehicle, because
   *  `start_pickup_route` inserts the route and its seats in one
   *  transaction. `[]` is a solo route — an explicit choice, not a
   *  missing argument. */
  onCreateRoute: (vehicleId: string, crewIds: string[]) => void;
  isCreatingRoute: boolean;
  /** start_pickup_route's error message (already a readable Spanish string
   *  raised by the RPC, e.g. "El conductor ya tiene una ruta de retiro
   *  activa" — never a raw Postgres error, see start_pickup_route(UUID)). */
  createRouteError?: string | null;
}

function matchesQuery(row: ManifestRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.externalLoadId.toLowerCase().includes(q) ||
    (row.retailerName ?? '').toLowerCase().includes(q) ||
    (row.pickupPoint ?? '').toLowerCase().includes(q)
  );
}

export function PickupMobileStartRoute({
  operatorId,
  currentUserId,
  pendingRows,
  selectedIds,
  onToggleSelect,
  selectedManifests,
  onCreateRoute,
  isCreatingRoute,
  createRouteError = null,
}: PickupMobileStartRouteProps) {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  // spec-61 Task 5 — who rides along. Held here rather than inside
  // CrewSelect so it is the same array the button hands to the RPC.
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  // FULL (unfiltered) membership — the only correct source for tri-state and
  // toggle-all. Review fix: a group built from the search-narrowed
  // `filteredRows` below has a truncated `selectableIds`, which desynced the
  // client checkbox (and what toggling it actually selected) from clients'
  // real membership whenever a search hid some of their manifests.
  const fullGroupsByClient = useMemo(() => {
    const map = new Map<string, StartRouteClientGroup>();
    for (const g of groupPendingManifests(pendingRows)) map.set(g.client, g);
    return map;
  }, [pendingRows]);

  const filteredRows = useMemo(
    () => (query.trim() ? pendingRows.filter((r) => matchesQuery(r, query)) : pendingRows),
    [pendingRows, query],
  );
  const groups: StartRouteClientGroup[] = useMemo(
    () => groupPendingManifests(filteredRows),
    [filteredRows],
  );

  function handleToggleClient(client: string) {
    const full = fullGroupsByClient.get(client);
    if (!full || full.selectableIds.length === 0) return;
    const allSelected = full.selectableIds.every((id) => selectedIds.has(id));
    const idsToFlip = allSelected
      ? full.selectableIds
      : full.selectableIds.filter((id) => !selectedIds.has(id));
    // Not `idsToFlip.forEach(onToggleSelect)` — Array#forEach also passes
    // (index, array) to its callback, which `onToggleSelect` would receive
    // as extra arguments it never asked for.
    idsToFlip.forEach((id) => onToggleSelect(id));
  }

  const selectedPackages = selectedManifests.reduce((sum, m) => sum + m.packageCount, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="pickup-mobile-start-route">
      <section className="rounded-[10px] border border-accent bg-accent-muted p-4">
        <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-muted">
          NO TIENES RUTA ACTIVA
        </p>
        <p className="mt-1 text-[13px] text-text-secondary">Abre una ruta antes de escanear.</p>

        <div className="mt-3">
          <VehicleSelect operatorId={operatorId} value={vehicleId} onChange={setVehicleId} />
        </div>

        {/* Only a leader ever renders this screen (PickupMobileView branches
            on `role`), so the crew picker is unconditional here. The crew is
            NOT required: an untouched list opens a solo route. */}
        <CrewSelect
          operatorId={operatorId}
          excludeUserId={currentUserId}
          value={crewIds}
          onChange={setCrewIds}
        />

        {createRouteError && (
          // `text-error` (no top-level `error` token exists — only nested
          // `status.error*`) is a pre-existing dead class elsewhere in this
          // repo (VehicleSelect.tsx); using the real token here instead.
          <p role="alert" className="mt-2 text-[12.5px] text-status-error-text">
            {createRouteError}
          </p>
        )}

        <button
          type="button"
          disabled={!vehicleId || isCreatingRoute}
          onClick={() => vehicleId && onCreateRoute(vehicleId, crewIds)}
          className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-colors active:opacity-90 disabled:opacity-50"
        >
          {isCreatingRoute ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-5 w-5" aria-hidden="true" />
          )}
          Iniciar ruta de recogida
        </button>
      </section>

      {/* Review fix: this must match what's rendered below, which is built
          from `filteredRows` — using the unfiltered `pendingRows.length`
          here desynced the eyebrow from the list under a search (e.g. it
          kept reading "· 4" while only 1 matching group was shown). */}
      <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-muted">
        MANIFIESTOS POR RETIRAR · {filteredRows.length}
      </p>

      {searchOpen && (
        <input
          type="search"
          aria-label="Buscar carga"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por código, cliente o punto de retiro…"
          className="min-h-[44px] w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-muted"
        />
      )}

      {pendingRows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Sin recogidas pendientes"
          description="No tienes manifiestos por retirar hoy."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Sin resultados"
          description="Ninguna carga coincide con la búsqueda."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((group) => (
            <PickupMobileClientGroup
              key={group.client}
              group={group}
              selectionState={clientSelectionState(
                fullGroupsByClient.get(group.client)?.selectableIds ?? [],
                selectedIds,
              )}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onToggleClient={() => handleToggleClient(group.client)}
            />
          ))}
        </div>
      )}

      <footer className="flex items-center gap-3 rounded-[10px] border border-border bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <p
            data-testid="start-route-footer-totals"
            className="truncate text-[13px] font-semibold text-text"
          >
            <span className="font-mono">{selectedManifests.length}</span>{' '}
            {selectedManifests.length === 1 ? 'manifiesto' : 'manifiestos'} ·{' '}
            <span className="font-mono">{selectedPackages}</span> paq.
          </p>
          <p className="truncate text-[11px] text-text-muted">entran a la ruta</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSearchOpen((open) => !open);
            if (searchOpen) setQuery('');
          }}
          className="flex min-h-[44px] flex-none items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 text-[13px] font-medium text-text transition-colors active:bg-surface-raised"
        >
          {searchOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          {searchOpen ? 'Cerrar' : 'Buscar carga'}
        </button>
      </footer>
    </div>
  );
}
