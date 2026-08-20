'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClientSelectionState, StartRouteClientGroup } from '@/lib/pickup/pickupStartRouteGrouping';
import type { ManifestRow } from './ManifestTable';

/**
 * spec-54 mock 3j — one Cliente → Punto → Manifiesto group.
 *
 * The pickup POINT row is a header only, never selectable — it is not a row
 * in any table (`pickup_points` is not what `add_manifest_to_route` takes).
 * The MANIFEST is the unit of selection: the RPC accepts one manifest id at
 * a time, so the checkbox lives on the manifest row, and the client
 * checkbox is a tri-state shortcut over its children, not a separate
 * selection of its own.
 *
 * Review fix — the manifest row is SELECTION ONLY. An earlier draft also
 * made it open the scan flow (`onOpenPending` → `openPendingManifest`,
 * which writes `status: 'in_progress'` and navigates to
 * `/app/pickup/scan/...`). That contradicted this screen's own accent card
 * ("Abre una ruta antes de escanear.") and mutated a manifest to
 * in_progress with no route to attach it to — the spec-47 scan guard would
 * then refuse the scan, leaving it stuck in_progress with nothing scanned.
 * There is no route yet on 3j, so there is nothing to open here; opening a
 * manifest belongs to 3h (`PickupMobileActiveRoute`'s `onOpenRouteManifest`),
 * where a route genuinely exists.
 *
 * `selectionState` and the ids `onToggleClient` acts on are computed by the
 * PARENT (`PickupMobileStartRoute`) from the client's FULL, unfiltered
 * membership — never from `group`, which may be a search-narrowed view. See
 * `pickupStartRouteGrouping.ts`'s `clientSelectionState` doc for why.
 */
export interface PickupMobileClientGroupProps {
  /** Drives what's RENDERED (points/manifests, and the "N puntos · N
   *  paquetes" summary) — may be narrowed by "Buscar carga". Never used for
   *  selection-state math; see file header. */
  group: StartRouteClientGroup;
  selectionState: ClientSelectionState;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleClient: () => void;
}

export function PickupMobileClientGroup({
  group,
  selectionState,
  selectedIds,
  onToggleSelect,
  onToggleClient,
}: PickupMobileClientGroupProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      data-testid="start-route-client-group"
      className="overflow-hidden rounded-[10px] border border-border bg-surface"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-h-[44px] flex-1 items-center gap-2 px-3.5 py-2.5 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-none text-text-secondary" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-none text-text-secondary" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-text">{group.client}</p>
            <p className="truncate text-[11.5px] text-text-secondary">
              {group.pointCount} {group.pointCount === 1 ? 'punto' : 'puntos'} ·{' '}
              {group.packageCount} {group.packageCount === 1 ? 'paquete' : 'paquetes'}
            </p>
          </div>
        </button>

        <button
          type="button"
          role="checkbox"
          aria-checked={selectionState === 'all' ? 'true' : selectionState === 'some' ? 'mixed' : 'false'}
          aria-label={`Seleccionar todos los manifiestos de ${group.client}`}
          onClick={onToggleClient}
          disabled={selectionState === 'none' && group.selectableIds.length === 0}
          className="grid min-h-[44px] w-11 flex-none place-items-center disabled:opacity-40"
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid h-5 w-5 place-items-center rounded border-2 transition-colors',
              selectionState === 'none'
                ? 'border-border-strong bg-surface'
                : 'border-accent bg-accent',
            )}
          >
            {selectionState === 'all' && (
              <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3.4} />
            )}
            {selectionState === 'some' && (
              <span className="h-[2px] w-2.5 rounded-full bg-accent-light-foreground" />
            )}
          </span>
        </button>
      </div>

      {expanded &&
        group.points.map((point) => (
          <div key={point.point} className="border-t border-border-subtle">
            <div className="flex items-center gap-1.5 bg-background px-3.5 py-2 text-[11.5px] text-text-secondary">
              <MapPin className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span className="truncate">{point.point}</span>
            </div>
            {point.manifests.map((m) => (
              <ManifestSelectRow
                key={m.externalLoadId}
                manifest={m}
                selected={m.id != null && selectedIds.has(m.id)}
                onToggle={() => m.id && onToggleSelect(m.id)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function ManifestSelectRow({
  manifest,
  selected,
  onToggle,
}: {
  manifest: ManifestRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const selectable = manifest.id != null;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Seleccionar ${manifest.externalLoadId}`}
      aria-disabled={!selectable}
      disabled={!selectable}
      onClick={onToggle}
      className="flex min-h-[52px] w-full items-center gap-3 border-t border-border-subtle px-3.5 py-2 text-left disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-5 w-5 flex-none place-items-center rounded border-2 transition-colors',
          selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
        )}
      >
        {selected && <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3.4} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12.5px] font-semibold text-text">
          {manifest.externalLoadId}
        </p>
        <p className="truncate text-[11px] text-text-secondary">
          <span className="font-mono">{manifest.orderCount}</span>{' '}
          {manifest.orderCount === 1 ? 'orden' : 'órdenes'} ·{' '}
          <span className="font-mono">{manifest.packageCount}</span>{' '}
          {manifest.packageCount === 1 ? 'paquete' : 'paquetes'}
        </p>
      </div>
    </button>
  );
}
