'use client';

import { Check, Circle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { expectedLabel } from '@/lib/pickup/manifestProgress';
import { timeLabel } from '@/lib/pickup/pickupMobileHelpers';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * spec-54 3h redesign — a load below the hero "next" card: much smaller,
 * a small circle indicator, the pickup point name in semibold, and a muted
 * `CODE · N paquetes · N órdenes` line. The completed variant swaps the
 * circle for a green check and adds a `COMPLETADA` label plus
 * `N notas · cerrada HH:MM` (from `manifests.completed_at` — see
 * `useRouteManifests.ts`).
 *
 * Review round 2 item 6 — this is deliberately labelled "notas", not
 * "diferencias": `discrepancy_notes` rows are written only when a driver
 * manually types a note about a missing package, and the count excludes
 * `not_found`/unexpected scans (tracked separately in `pickup_scans`, via
 * `useDiscrepancies`). "0 diferencias" would read as a completeness
 * guarantee this number does not make — "0 notas" does not.
 *
 * `discrepancy_count` is optional on the shared `RouteManifestRow` type
 * (other callers of that type never fetch it). `?? 0` here would render a
 * fabricated "we checked, zero problems" for a caller that never looked.
 * `undefined` renders as "—" instead — the same "unknown, not zero" rule
 * `manifestProgress.ts` already applies to `total_packages`.
 */
export interface PickupMobileCompactRowProps {
  /**
   * spec-80 fase 2b adds `needsSignature`: a manifest
   * `trg_route_receptions_status_sync` closed (`status: 'completed'`)
   * WITHOUT ever reaching the Firma screen (see `needsSignatureRescue`,
   * `pickupMobileHelpers.ts`). Shares the "completed" subtitle layout
   * (notas · cerrada HH:MM — both are populated the same way for a rescue
   * load) but swaps the chip and leading icon for a warning, so it reads
   * as needing attention rather than done.
   */
  variant: 'remaining' | 'completed' | 'needsSignature';
  manifest: RouteManifestRow;
  onOpen: () => void;
}

export function PickupMobileCompactRow({ variant, manifest, onOpen }: PickupMobileCompactRowProps) {
  const isCompleted = variant === 'completed';
  const needsSignature = variant === 'needsSignature';
  // Both finished variants show the same "N notas · cerrada HH:MM" line —
  // only the icon/chip differ.
  const showsClosedSubtitle = isCompleted || needsSignature;
  const title = manifest.pickup_location ?? manifest.external_load_id;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[52px] w-full items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3 py-2 text-left transition-colors active:bg-surface-raised"
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-6 w-6 flex-none place-items-center rounded-full border',
          isCompleted
            ? 'border-status-success-border bg-status-success-bg text-status-success-text'
            : needsSignature
              ? 'border-status-error-border bg-status-error-bg text-status-error-text'
              : 'border-border-strong text-transparent',
        )}
      >
        {isCompleted ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ) : needsSignature ? (
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
        ) : (
          <Circle className="h-2 w-2 fill-current" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-text">{title}</p>
        <p className="truncate text-[11.5px] text-text-secondary">
          <span className="font-mono">{manifest.external_load_id}</span>
          {showsClosedSubtitle ? (
            <>
              {' · '}
              <span className="font-mono">
                {manifest.discrepancy_count ?? '—'}
              </span>{' '}
              notas
              {manifest.completed_at && (
                <>
                  {' · cerrada '}
                  <span className="font-mono">{timeLabel(manifest.completed_at)}</span>
                </>
              )}
            </>
          ) : (
            <>
              {' · '}
              <span className="font-mono">{expectedLabel(manifest.total_packages)}</span> paquetes
              {' · '}
              <span className="font-mono">{manifest.total_orders ?? '—'}</span> órdenes
            </>
          )}
        </p>
      </div>

      {isCompleted && (
        <span className="flex-none text-[10px] font-medium uppercase tracking-[.06em] text-status-success-text">
          COMPLETADA
        </span>
      )}
      {needsSignature && (
        <span className="flex-none text-[10px] font-medium uppercase tracking-[.06em] text-status-error-text">
          FALTA FIRMA
        </span>
      )}
    </button>
  );
}
