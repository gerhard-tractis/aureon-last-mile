import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { expectedLabel, progressLabel } from '@/lib/pickup/manifestProgress';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * spec-54 phase 4.6 — "SIGUIENTE PARADA" from mock 1i, adapted to this
 * screen's real domain: this is the pickup route, so there is no delivery
 * stop to show. The nearest real equivalent is the next manifest the driver
 * still has to verify. Still omitted from the mock:
 * - ETA — no per-manifest/per-stop timing exists anywhere in this domain.
 * - "llamar" square button — a contact phone exists (`pickup_points
 *   .pickup_locations[].contact_phone`), but only reachable via a join this
 *   screen's query doesn't make (manifests carries no pickup_point_id, only
 *   a free-text `pickup_location`). Not "no phone", just "not one query
 *   away" — see the phase 4.6 spec note.
 * - "más opciones" square button — no secondary-actions menu is defined for
 *   this screen.
 *
 * The index badge is a stable position within `useRouteManifests`' now
 * deterministically-ordered (created_at DESC) list — a real, stable
 * identifier, not a claim about a geographic visiting order like the mock's
 * "PARADA 19".
 */

interface NextManifestCardProps {
  manifest: RouteManifestRow;
  /** 0-based position within the route's (now deterministically ordered) manifest list. */
  index: number;
  onVerify: (externalLoadId: string) => void;
}

export function NextManifestCard({ manifest, index, onVerify }: NextManifestCardProps) {
  return (
    <div className="rounded-lg border-2 border-accent bg-surface p-4" data-testid="next-manifest-card">
      <p className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted mb-2">
        Siguiente manifiesto
      </p>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-accent-muted font-mono text-sm font-bold text-accent-emphasis">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-text truncate">
            {manifest.retailer_name ?? 'Retailer desconocido'}
          </p>
          <p className="text-[11.5px] text-text-secondary mt-0.5 truncate">
            {manifest.external_load_id} · {manifest.total_orders ?? 0} órdenes ·{' '}
            {expectedLabel(manifest.total_packages)} paquetes
          </p>
          {manifest.pickup_location && (
            <p className="flex items-center gap-1 text-[11.5px] text-text-secondary mt-0.5 truncate">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              {manifest.pickup_location}
            </p>
          )}
        </div>
        <span className="font-mono text-sm font-semibold text-text shrink-0">
          {progressLabel(manifest)}
        </span>
      </div>
      <Button
        type="button"
        className="mt-3 w-full min-h-[52px]"
        onClick={() => onVerify(manifest.external_load_id)}
      >
        Verificar
      </Button>
    </div>
  );
}
