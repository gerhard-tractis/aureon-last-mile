'use client';

import type { ShiftScanStats } from '@/lib/dispatch/mobile/crew-board';

/** spec-76 2a — ESCANEADOS HOY / RITMO tiles. `ratePerHour` renders "—"
 *  rather than "0/h" until there is a real spread to derive it from
 *  (computeTodayScanStats) — a rate is either known or not shown, never
 *  guessed. */
export function DispatchCrewShiftStats({ scannedToday, ratePerHour }: ShiftScanStats) {
  return (
    <div className="grid grid-cols-2 gap-2.5" data-testid="dispatch-crew-shift-stats">
      <div className="rounded-[10px] border border-border bg-surface p-3">
        <p className="text-[10.5px] uppercase tracking-[.06em] text-text-muted">Escaneados hoy</p>
        <p className="mt-1 font-mono text-[20px] font-semibold text-text">{scannedToday}</p>
      </div>
      <div className="rounded-[10px] border border-border bg-surface p-3">
        <p className="text-[10.5px] uppercase tracking-[.06em] text-text-muted">Ritmo</p>
        <p className="mt-1 font-mono text-[20px] font-semibold text-text">
          {ratePerHour != null ? `${Math.round(ratePerHour)}/h` : '—'}
        </p>
      </div>
    </div>
  );
}
