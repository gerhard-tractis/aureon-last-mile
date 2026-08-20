'use client';

import { driverInitials, shortDateLabel } from '@/lib/pickup/pickupMobileHelpers';

/**
 * spec-54 3h redesign — mock header: "Recogidas de hoy" in display type,
 * a subtitle "mié 13/08 · M. Rojas · PR-2026-0148" (date · driver · route
 * code), and a round avatar with the driver's initials at top right.
 */
export interface PickupMobileHeaderProps {
  driverName: string | null;
  routeCode: string;
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
}

export function PickupMobileHeader({ driverName, routeCode, now }: PickupMobileHeaderProps) {
  const date = now ?? new Date();
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-heading text-[22px] font-semibold leading-[1.1] tracking-[-.01em] text-text">
          Recogidas de hoy
        </h2>
        <p
          data-testid="mobile-header-subtitle"
          className="mt-1 truncate text-[12.5px] text-text-secondary"
        >
          {shortDateLabel(date)}
          {driverName && <> · {driverName}</>}
          {' · '}
          <span className="font-mono font-semibold text-text">{routeCode}</span>
        </p>
      </div>
      <div
        data-testid="mobile-header-avatar"
        aria-hidden="true"
        className="grid h-10 w-10 flex-none place-items-center rounded-full border border-border bg-surface-raised font-heading text-[13px] font-semibold text-text"
      >
        {driverInitials(driverName)}
      </div>
    </header>
  );
}
