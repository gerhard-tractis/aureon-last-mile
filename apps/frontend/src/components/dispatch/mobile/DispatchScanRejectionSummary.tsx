'use client';

import type { RejectionTallyRow } from '@/lib/dispatch/mobile/scan-session';

/**
 * spec-76 2f — "N RECHAZOS" + "OTROS MOTIVOS DE RECHAZO" breakdown. Both
 * are this browser tab's own count, not a server figure: rejections are
 * not persisted anywhere (see useRouteScanSession.ts's own comment and the
 * endpoint it calls) — spec-79 H4 is what would let this survive a
 * refresh. "en esta sesión", not "en este turno" (spec-76 review): a
 * turno can span more than one browser tab/session and this count cannot
 * — it resets on reload and is scoped to this one route, so the copy must
 * not claim a wider scope than the data actually has. Renders nothing
 * until the first rejection, so an empty session never shows "0 RECHAZOS"
 * as if it had already measured one.
 */
export interface DispatchScanRejectionSummaryProps {
  rejectionCount: number;
  tally: readonly RejectionTallyRow[];
}

export function DispatchScanRejectionSummary({ rejectionCount, tally }: DispatchScanRejectionSummaryProps) {
  if (rejectionCount === 0) return null;
  return (
    <section data-testid="dispatch-scan-rejection-summary" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-status-error-border bg-status-error-bg px-2 py-1 font-mono text-[11px] font-semibold text-status-error-text">
          {rejectionCount} RECHAZO{rejectionCount === 1 ? '' : 'S'}
        </span>
        <span className="text-[11px] uppercase tracking-[.06em] text-text-muted">en esta sesión</span>
      </div>
      {tally.length > 0 && (
        <div>
          <h3 className="text-[10.5px] uppercase tracking-[.06em] text-text-muted">Otros motivos de rechazo</h3>
          <ul className="mt-1.5 space-y-1">
            {tally.map((row) => (
              <li key={row.code} className="flex items-center justify-between text-[12px] text-text">
                <span>{row.label}</span>
                <span className="font-mono text-text-secondary">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
