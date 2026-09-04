'use client';

import { memo } from 'react';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

export interface DispatchPackageRowProps {
  pkg: StopPackageRow;
}

/**
 * spec-76 2h — one package row: barcode, order, "2 de 3", client.
 *
 * No remove control here — escalated during review and decided: `DELETE
 * .../packages/[pkgId]` (what a "Quitar" here would have to call) removes
 * the WHOLE order from the route's plan, a planning decision spec-70
 * deliberately gates to a manager role (`canRemoveFromPlan`), not the
 * crew scanning at the dock. RouteBuilder (desktop, the manager surface)
 * already has its own removal control against this same endpoint — this
 * screen does not duplicate it. See DispatchPackagesByStop.tsx's header
 * comment for the crew's actual action here (spec-79 H4).
 *
 * `memo`'d per Lecciones aplicadas #8 — a route can carry 148 of these,
 * and `pkg` is a stable object per render from DispatchPackagesByStop's
 * `useMemo`'d grouping, so this memo has something to compare against.
 */
export const DispatchPackageRow = memo(function DispatchPackageRow({ pkg }: DispatchPackageRowProps) {
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
    </div>
  );
});
