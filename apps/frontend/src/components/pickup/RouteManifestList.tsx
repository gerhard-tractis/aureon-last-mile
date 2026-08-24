'use client';

import { Package, ShoppingCart, X } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { isManifestComplete, progressLabel } from '@/lib/pickup/manifestProgress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

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
  /** spec-54 3h redesign — `manifests.completed_at`, for the compact
   *  completed row's "cerrada HH:MM". Optional/undefined for callers that
   *  never fetch it (this list does not need it); null when the DB column
   *  itself is null (not yet completed). */
  completed_at?: string | null;
  /** spec-54 3h redesign — count of `discrepancy_notes` rows for this
   *  manifest, for the compact completed row's "N notas". This is a note
   *  count, not a full discrepancy count: `discrepancy_notes` is written
   *  only when a driver manually types a note about a missing package, and
   *  it excludes `not_found`/unexpected scans (a different figure, tracked
   *  in `pickup_scans` via `useDiscrepancies`). Optional/undefined for
   *  callers that never fetch it (this list does not need it) — render
   *  `undefined` as unknown, never as a fabricated 0. */
  discrepancy_count?: number;
}

interface RouteManifestListProps {
  manifests: RouteManifestRow[];
  onManifestClick: (externalLoadId: string) => void;
  /**
   * spec-64 Task 3 — removes a carga from the open route. Optional and
   * additive: when omitted, no remove control renders at all, so every
   * existing caller is unaffected. Only offered per-row when
   * `verified_count === 0` — one verified scan means the carga is
   * physically on the truck and the server (`remove_manifest_from_route`)
   * refuses the removal, so offering the button then would be a lie.
   */
  onRemove?: (manifestId: string) => void;
}

/**
 * Shows every manifest currently linked to the active route, with its
 * verified/expected progress. Each row jumps into the per-manifest scan
 * flow so the driver can continue verification.
 */
export function RouteManifestList({
  manifests,
  onManifestClick,
  onRemove,
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
        const canRemove = !!onRemove && m.verified_count === 0;
        return (
          <div
            key={m.id}
            // hover:border-accent-light, not hover:border-accent/50: this
            // file's colour tokens are bare `var(--color-…)` values with no
            // <alpha-value> channel, so a Tailwind opacity modifier here
            // emits no CSS at all (same root cause as the map placeholder's
            // border fix). accent-light is a real, already-defined token.
            className="relative rounded-lg border border-border bg-surface transition-colors hover:border-accent-light"
          >
            <button
              type="button"
              onClick={() => onManifestClick(m.external_load_id)}
              className="w-full text-left p-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="flex items-center justify-between gap-3 pr-11">
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
            {canRemove && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Quitar ${m.external_load_id} de la ruta en curso`}
                    className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded text-text-secondary hover:bg-status-error-bg hover:text-status-error-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Quitar esta carga de la ruta?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {m.external_load_id} vuelve a la lista de cargas pendientes y puede
                      agregarse de nuevo a esta u otra ruta.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onRemove(m.id)}>
                      Quitar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        );
      })}
    </div>
  );
}
