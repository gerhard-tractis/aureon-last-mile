'use client';

import { Check, ChevronRight, MapPin, Package, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { progressLabel } from '@/lib/pickup/manifestProgress';

/**
 * spec-54 3h — "Recogidas del día", móvil. A single manifest card.
 *
 * No stop sequence: `manifests` hangs off `pickup_routes` by FK only, no
 * `sequence`/`stop_order` column, so the badge is a STATUS indicator, never
 * a position number (a prior draft numbered cards 1-2-3 — that draft was
 * wrong per the spec-54 handoff).
 *
 * `totalPackages` is nullable (`manifests.total_packages` — OCR/manual
 * intake does not guarantee it). `null` renders as an unknown total ("—"),
 * never as 0 or 100% via `progressLabel`, imported from `manifestProgress.ts`
 * rather than reimplemented here.
 *
 * Selection and "open" are two SIBLING controls, not nested. Nesting a
 * `<button>` inside `role="checkbox"` is invalid ARIA — checkbox is on the
 * children-presentational list, so assistive tech flattens the inner button
 * away and a screen-reader user could select a manifest but never open it.
 * Selection is also never colour-only (WCAG 1.4.1): the checkbox renders a
 * visible box-plus-check glyph, not just a border/fill change.
 *
 * `aria-label` on the checkbox and the open button ALSO overrides their
 * accessible name from content — so the load id, retailer, pickup location,
 * order/package counts and the status badge (all rendered inside the
 * labelled checkbox) would otherwise be announced nowhere. Both controls
 * carry `aria-describedby` pointing at that details block instead of
 * relying on content-derived naming, which keeps the concise action name
 * ("Seleccionar CARGA-001" / "Abrir CARGA-001") as the primary announcement
 * while still exposing the rest as a reachable description. Chosen over
 * moving the details outside the checkbox: that would fight the visual
 * design (the badge and counts read as part of the tappable selection
 * area), whereas `aria-describedby` needs no layout change and — being a
 * plain id reference — works whether the referenced node is a descendant
 * (the checkbox) or not (the open button).
 */

export type CardStatusTone = 'pending' | 'progress' | 'complete';

const TONE: Record<CardStatusTone, string> = {
  pending: 'border-border bg-surface-raised text-text-secondary',
  progress: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  complete: 'border-status-success-border bg-status-success-bg text-status-success-text',
};

export interface PickupMobileManifestCardProps {
  externalLoadId: string;
  retailerName: string | null;
  pickupLocation: string | null;
  /** Real order count. Never null in either data source this card renders
   *  from — shown as-is. */
  totalOrders: number | null;
  /** Null = unknown total (intake never recorded a package count). */
  totalPackages: number | null;
  verifiedCount: number;
  statusLabel: string;
  statusTone: CardStatusTone;
  /** When set, the card renders a checkbox control (route-draft selection)
   *  alongside a separate "open" button — two siblings, mirroring
   *  `ManifestTable`'s row-click-selects / id-click-opens split. When
   *  absent, the whole card is a single button that opens the manifest. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onOpen: () => void;
}

export function PickupMobileManifestCard({
  externalLoadId,
  retailerName,
  pickupLocation,
  totalOrders,
  totalPackages,
  verifiedCount,
  statusLabel,
  statusTone,
  selectable = false,
  selected = false,
  onSelect,
  onOpen,
}: PickupMobileManifestCardProps) {
  const packagesLabel = progressLabel({
    verified_count: verifiedCount,
    total_packages: totalPackages,
  });

  // Stable per manifest — external_load_id is unique per operator (see
  // manifests' unique_manifest_per_operator constraint) — so this is safe
  // to use as a DOM id even with many cards on screen at once.
  const detailsId = `manifest-details-${externalLoadId}`;

  const badge = (
    <span
      data-testid="card-status-badge"
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-medium leading-none',
        TONE[statusTone],
      )}
    >
      {statusLabel}
    </span>
  );

  const details = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[13px] font-semibold text-text">{externalLoadId}</p>
          <p className="truncate text-[12.5px] text-text-secondary">
            {retailerName ?? 'Sin cliente'}
          </p>
        </div>
        {badge}
      </div>

      {pickupLocation && (
        <div className="mt-2 flex items-center gap-1 text-[11.5px] text-text-secondary">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{pickupLocation}</span>
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-4 text-[12px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <ShoppingCart className="h-3.5 w-3.5" />
          <span className="font-mono font-semibold text-text">{totalOrders ?? '—'}</span>
          <span>órdenes</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" />
          <span className="font-mono font-semibold text-text">{packagesLabel}</span>
          <span>paquetes</span>
        </span>
      </div>
    </>
  );

  if (!selectable) {
    return (
      <button
        type="button"
        data-testid="mobile-manifest-card"
        onClick={onOpen}
        className="w-full min-h-[76px] rounded-[10px] border border-border bg-surface p-3.5 text-left transition-colors active:bg-surface-raised"
      >
        {details}
      </button>
    );
  }

  return (
    <div data-testid="mobile-manifest-card" className="flex items-stretch gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Seleccionar ${externalLoadId}`}
        aria-describedby={detailsId}
        onClick={onSelect}
        className={cn(
          'flex min-h-[76px] flex-1 items-start gap-3 rounded-[10px] border p-3.5 text-left transition-colors',
          selected ? 'border-accent bg-accent-muted' : 'border-border bg-surface',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid h-5 w-5 flex-none place-items-center rounded border-2 transition-colors',
            selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
          )}
        >
          {selected && (
            <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3.4} />
          )}
        </span>
        <div id={detailsId} className="min-w-0 flex-1">{details}</div>
      </button>

      <button
        type="button"
        data-testid="mobile-manifest-open"
        aria-label={`Abrir ${externalLoadId}`}
        aria-describedby={detailsId}
        onClick={onOpen}
        className="flex min-h-[76px] w-11 flex-none items-center justify-center rounded-[10px] border border-border bg-surface text-text-secondary transition-colors hover:text-text active:bg-surface-raised"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
