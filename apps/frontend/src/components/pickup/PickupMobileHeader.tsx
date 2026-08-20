'use client';

import { driverInitials, shortDateLabel } from '@/lib/pickup/pickupMobileHelpers';

/**
 * spec-54 3h/3j — the ONE header for the mobile Recogida screen, shared by
 * both mutually-exclusive states (see PickupMobileView.tsx): "Recogidas de
 * hoy" in display type, a subtitle "M. Rojas · mié 13/08 · PR-2026-0148"
 * (driver · date · route code), and a round avatar with the driver's
 * initials at top right.
 *
 * Review fix — order is DRIVER first, then date, matching the 3j artboard
 * ("Marcela R. · mié 13/08") literally. An earlier draft rendered
 * date-first; changed here for both 3h and 3j since they share this one
 * component, and 3h's own tests only assert substring presence, not order.
 *
 * `routeCode` is optional: the 3j mock (no active route yet) shows the same
 * header WITHOUT a route code segment — there is no route to name. Passing
 * `null`/`undefined` omits that segment cleanly rather than rendering a
 * trailing " · " separator or an empty <span>.
 *
 * Coordinator fix (found live in QA at 390px): the page-level `<h1>Recogida
 * </h1>` + "N manifiestos por retirar" subtitle in page.tsx is the DESKTOP
 * header and must not also render on mobile alongside this one — see the
 * `!isBelowLg` guard added around it in page.tsx. This component is the only
 * header mobile renders, in both the 3h and 3j states.
 */
export interface PickupMobileHeaderProps {
  driverName: string | null;
  routeCode?: string | null;
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
          {driverName && <>{driverName} · </>}
          {shortDateLabel(date)}
          {routeCode && (
            <>
              {' · '}
              <span className="font-mono font-semibold text-text">{routeCode}</span>
            </>
          )}
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
