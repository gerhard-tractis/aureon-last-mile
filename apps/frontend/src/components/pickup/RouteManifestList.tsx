'use client';

import { Package, ShoppingCart } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { isManifestComplete, progressLabel } from '@/lib/pickup/manifestProgress';

/** Mirrors `manifest_status_enum` (packages/database/supabase/migrations/
 *  20260310100000_create_pickup_verification_tables.sql:33). */
export type ManifestStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface RouteManifestRow {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  /** Free-text pickup address (manifests.pickup_location). Null when not
   *  captured at intake — never fabricate a value when absent. */
  pickup_location: string | null;
  total_orders: number | null;
  /** Null when intake (OCR or manual) never recorded a package count — an
   *  unknown denominator, not zero. Callers must not read null as "complete". */
  total_packages: number | null;
  /** Count of verified pickup_scans for this manifest. */
  verified_count: number;
  /** spec-54 3h (mobile) — real lifecycle state from `manifests.status`,
   *  used to sort cards and choose a status badge. Optional because callers
   *  that predate this field (this list's own rows here) still work without
   *  it; added for the mobile card view, which needs a genuine status
   *  rather than deriving one from verified_count. */
  status?: ManifestStatus;
}

interface RouteManifestListProps {
  manifests: RouteManifestRow[];
  onManifestClick: (externalLoadId: string) => void;
}

/**
 * Shows every manifest currently linked to the active route, with its
 * verified/expected progress. Each row jumps into the per-manifest scan
 * flow so the driver can continue verification.
 */
export function RouteManifestList({
  manifests,
  onManifestClick,
}: RouteManifestListProps) {
  if (manifests.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin manifiestos en la ruta"
        description="Agrega manifiestos para empezar a verificar paquetes."
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="route-manifest-list">
      {manifests.map((m) => {
        const complete = isManifestComplete(m);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onManifestClick(m.external_load_id)}
            // hover:border-accent-light, not hover:border-accent/50: this
            // file's colour tokens are bare `var(--color-…)` values with no
            // <alpha-value> channel, so a Tailwind opacity modifier here
            // emits no CSS at all (same root cause as the map placeholder's
            // border fix). accent-light is a real, already-defined token.
            className="w-full text-left rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent-light"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-text truncate">
                  {m.retailer_name ?? 'Retailer desconocido'}
                </h3>
                <p className="font-mono text-xs text-text-secondary mt-0.5">
                  {m.external_load_id}
                </p>
              </div>
              <div className="flex gap-3 text-sm text-text-secondary shrink-0">
                <div className="flex items-center gap-1">
                  <ShoppingCart className="h-4 w-4" />
                  <span className="font-mono">{m.total_orders ?? 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Package className="h-4 w-4" />
                  <span className="font-mono">{progressLabel(m)}</span>
                </div>
              </div>
            </div>
            {complete && (
              <p className="mt-2 text-xs font-medium text-status-success">
                Verificación completa
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
