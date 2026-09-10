'use client';

import { PickupMobileCompactRow } from './PickupMobileCompactRow';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * spec-80 fase 2b (ronda 2) — the mobile rescue entry, extracted so it can
 * be rendered from `PickupMobileView.tsx`'s no-route branch (the place
 * that's actually reachable — see that file's doc comment) rather than
 * `PickupMobileActiveRoute.tsx` (ronda 1's location, proven unreachable:
 * `trg_route_receptions_status_sync` flips the whole route to `status:
 * 'received'` in the same statement that completes a manifest without a
 * signature, and `get_my_active_pickup_route` only returns `in_progress`
 * routes).
 *
 * Always visible when non-empty — never behind a tap. A rescue is not
 * something the crew should have to know to look for; that's the exact
 * discoverability gap this fase closes.
 */
export function RescueManifestsSection({
  manifests,
  onOpen,
}: {
  manifests: RouteManifestRow[];
  onOpen: (loadId: string) => void;
}) {
  if (manifests.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-status-error-text">
        Pendientes de firma
      </p>
      {manifests.map((m) => (
        <PickupMobileCompactRow
          key={m.id}
          variant="needsSignature"
          manifest={m}
          onOpen={() => onOpen(m.external_load_id)}
        />
      ))}
    </div>
  );
}
