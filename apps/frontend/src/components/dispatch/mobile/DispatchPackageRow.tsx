'use client';

import { memo } from 'react';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

export interface DispatchPackageRowProps {
  pkg: StopPackageRow;
  onRemove: (pkg: StopPackageRow) => void;
}

/**
 * spec-76 2h — one package row: barcode, order, "2 de 3", client, then a
 * "Quitar" control.
 *
 * Lecciones aplicadas #4 — this is the fourth instance of the nested-
 * interactive shape this module has hit. The fix here is the cheapest one
 * available: a plain `<div>` container (no role, no onClick) with a native
 * `<button>` as a SIBLING, not a descendant of anything interactive — so
 * there is no ARIA "presentational children" trap to fall into (#4) and no
 * need for `stopPropagation` (#6), because the container never listens for
 * clicks in the first place.
 *
 * `memo`'d per Lecciones aplicadas #8 — a route can carry 148 of these; the
 * `onRemove` identity DispatchPackagesByStop hands down is stabilised with
 * `useCallback` there, so this memo actually prevents re-renders instead of
 * doing nothing (the two go together, or neither is worth it).
 */
export const DispatchPackageRow = memo(function DispatchPackageRow({ pkg, onRemove }: DispatchPackageRowProps) {
  const metaParts = [pkg.orderNumber, pkg.packageNumber, pkg.clientName].filter(
    (v): v is string => !!v,
  );

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-[8px] border border-border-subtle px-3 py-2"
      data-testid={`dispatch-package-row-${pkg.packageId}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono text-[12.5px] font-medium text-text">{pkg.barcode}</span>
        <span className="truncate text-[11.5px] text-text-secondary">{metaParts.join(' · ')}</span>
        {pkg.notEmbarked && (
          <span className="text-[11px] font-semibold uppercase tracking-[.04em] text-status-error-text">
            NO EMBARCADO
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(pkg)}
        className="min-h-[44px] min-w-[44px] shrink-0 rounded-[8px] border border-border px-3 text-[12.5px] font-medium text-text-secondary active:opacity-90"
      >
        Quitar
      </button>
    </div>
  );
});
