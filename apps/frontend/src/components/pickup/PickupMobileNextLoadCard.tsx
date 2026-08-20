'use client';

import { ChevronRight, ScanBarcode } from 'lucide-react';
import { expectedLabel } from '@/lib/pickup/manifestProgress';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * spec-54 3h redesign — the screen's centrepiece: the driver's next stop.
 * Leads with the PLACE, not the load code — "where am I going and what do
 * I press" — with one large "Iniciar recogida" button.
 *
 * Line mapping (only two real columns exist — `manifests.retailer_name`
 * and `pickup_location`, a free-text field; there is no separate "pickup
 * point name" distinct from it):
 *   - headline  = pickup_location — the actual place the driver goes.
 *     Falls back to the load code when intake never recorded a location,
 *     never fabricated text.
 *   - secondary = retailer_name alone. The mock's "retailer · location
 *     detail" line has no honest second half in our data — pickup_location
 *     is already spent as the headline, so repeating it here would
 *     duplicate rather than add information.
 *   - the mock's third, muted "street address" line is omitted entirely:
 *     there is no address column separate from pickup_location.
 */
export interface PickupMobileNextLoadCardProps {
  manifest: RouteManifestRow;
  onStart: () => void;
}

export function PickupMobileNextLoadCard({ manifest, onStart }: PickupMobileNextLoadCardProps) {
  const headline = manifest.pickup_location ?? manifest.external_load_id;
  return (
    <div className="rounded-[14px] border-2 border-accent bg-surface p-4">
      <div className="flex items-start justify-between">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-full border border-accent bg-accent-muted text-accent-emphasis"
        >
          <ChevronRight className="h-4 w-4" />
        </span>
        {/* white-on-#ca9a04 (bg-accent/text-accent-foreground) is ~2.6:1,
            below the 4.5:1 floor — globals.css's own comment on
            --color-accent-light-foreground says as much ("White fails
            contrast on #e6c15c"). Match the repo's existing gold-button
            precedent (distribution/page.tsx, TowerHeader.tsx,
            reception/page.tsx, RouteDraftPanel.tsx). */}
        <span className="rounded-full bg-accent-light px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[.06em] text-accent-light-foreground">
          SIGUIENTE
        </span>
      </div>

      <h3 className="mt-3 font-heading text-[19px] font-semibold leading-[1.15] text-text">
        {headline}
      </h3>
      {manifest.retailer_name && (
        <p className="mt-0.5 text-[13px] text-text-secondary">{manifest.retailer_name}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] font-semibold text-text">
          {manifest.external_load_id}
        </span>
        <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-secondary">
          <span className="font-mono font-semibold text-text">
            {expectedLabel(manifest.total_packages)}
          </span>{' '}
          paquetes
        </span>
        <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-secondary">
          <span className="font-mono font-semibold text-text">{manifest.total_orders ?? '—'}</span>{' '}
          órdenes
        </span>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-colors active:opacity-90"
      >
        <ScanBarcode className="h-5 w-5" />
        Iniciar recogida
      </button>
    </div>
  );
}
