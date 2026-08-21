'use client';

import { receptionInitials } from '@/lib/reception/reception-mobile-helpers';

/**
 * spec-62 3i — the header for the mobile Recepción yard screen: an andén
 * operator standing up, possibly gloved, scanning packages off a truck.
 * Small and factual by design — no KPI tiles, no theme switcher, nothing
 * below 13.5px (see spec-62 mobile design intent).
 *
 * Renunciation, deliberate: the 3i artboard reads "Recepción · Andén 2"
 * with "turno AM" beneath. Neither concept exists in the schema — there is
 * no reception-dock model (`dock_zones` belongs to distribution, a
 * different thing) and no shift/turno model at all. The spec records this
 * renunciation explicitly. Do NOT "complete" this header by inventing a
 * dock number or deriving a shift from the clock — title stays plain
 * "Recepción", subtitle is only the receptionist's name.
 */
export interface ReceptionMobileHeaderProps {
  userName: string | null;
}

export function ReceptionMobileHeader({ userName }: ReceptionMobileHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-heading text-[22px] font-semibold leading-[1.1] tracking-[-.01em] text-text">
          Recepción
        </h2>
        <p
          data-testid="reception-mobile-subtitle"
          className="mt-1 truncate text-[12.5px] text-text-secondary"
        >
          {userName}
        </p>
      </div>
      <div
        data-testid="reception-mobile-avatar"
        aria-hidden="true"
        className="grid h-10 w-10 flex-none place-items-center rounded-full border border-border bg-surface-raised font-heading text-[13px] font-semibold text-text"
      >
        {receptionInitials(userName)}
      </div>
    </header>
  );
}
