import { progressLabel } from '@/lib/pickup/manifestProgress';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * spec-54 phase 4.6 — "LUEGO" from mock 1i: the manifests after the one
 * highlighted in `NextManifestCard`, shown in compact rows. Capped at 3 per
 * the design spec ("dos o tres paradas siguientes"). The caller is
 * responsible for passing manifests that come AFTER the highlighted one, in
 * the same deterministic order — this component only caps the count.
 */

interface UpcomingManifestListProps {
  manifests: RouteManifestRow[];
}

export function UpcomingManifestList({ manifests }: UpcomingManifestListProps) {
  const upcoming = manifests.slice(0, 3);
  if (upcoming.length === 0) return null;

  return (
    <div data-testid="upcoming-manifest-list">
      <h2 className="font-heading text-sm font-semibold text-text mb-2">Luego</h2>
      <div className="rounded-lg border border-border bg-surface divide-y divide-border-subtle">
        {upcoming.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-[13px]">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-text truncate">
                {m.retailer_name ?? 'Retailer desconocido'}
              </p>
              <p className="font-mono text-[11px] text-text-muted truncate">
                {m.external_load_id}
              </p>
            </div>
            <span className="font-mono text-xs text-text-secondary shrink-0">
              {progressLabel(m)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
