'use client';

import { Package, ShoppingCart } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

export interface RouteManifestRow {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_orders: number | null;
  total_packages: number | null;
  /** Count of verified pickup_scans for this manifest. */
  verified_count: number;
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
        const expected = m.total_packages ?? 0;
        const verified = m.verified_count;
        const complete = expected > 0 && verified >= expected;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onManifestClick(m.external_load_id)}
            className="w-full text-left rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/50"
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
                  <span className="font-mono">{verified}/{expected}</span>
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
