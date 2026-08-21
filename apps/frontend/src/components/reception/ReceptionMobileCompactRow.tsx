'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { waitLabel, YARD_WAIT_WARNING_MINUTES } from '@/lib/reception/reception-mobile-helpers';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

/**
 * spec-62 3i — a non-hero row of the mobile Recepción yard screen. The mock
 * frames the hero card as the one decision this screen makes (the
 * longest-waiting truck); every other truck is a row, not a decision — so
 * this row is deliberately quieter: smaller type, no call-to-action, just a
 * chevron. The whole row is the touch target, mirroring
 * `PickupMobileCompactRow`.
 *
 * `waitingMinutes` arrives pre-computed by the page (Task 12), same as the
 * hero card — this component never calls `minutesSince` itself, so the
 * whole screen shares one clock read.
 *
 * `onOpen` is a plain callback, never a mutation. This row never calls
 * `open_route_reception` — that RPC ends the driver's trip.
 */
export interface ReceptionMobileCompactRowProps {
  route: IncomingRoute;
  waitingMinutes: number | null;
  onOpen: () => void;
}

export function ReceptionMobileCompactRow({
  route,
  waitingMinutes,
  onOpen,
}: ReceptionMobileCompactRowProps) {
  const overdue = waitingMinutes !== null && waitingMinutes >= YARD_WAIT_WARNING_MINUTES;
  const wait = waitLabel(waitingMinutes);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-[13px] border border-border bg-surface px-3.5 py-3 text-left transition-colors active:bg-surface-raised"
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-base font-bold text-text">{route.code}</p>
        <p className="mt-0.5 truncate text-[13.5px] text-text-secondary">
          <span data-testid="compact-row-packages">{route.expected_packages} paquetes</span>
          {wait && (
            <>
              {' · '}
              <span
                data-testid="compact-row-wait-badge"
                className={cn(
                  'inline-flex items-center gap-0.5 font-mono',
                  overdue && 'text-status-warning-text',
                )}
              >
                {/* Colour alone never carries a status here — a colour-blind
                    receptionist standing in the yard needs a second, shape
                    channel to tell the overdue wait apart from a normal one. */}
                {overdue && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                {wait}
              </span>
            </>
          )}
        </p>
      </div>

      <span
        aria-hidden="true"
        className="grid h-11 w-11 flex-none place-items-center text-text-secondary"
      >
        <ChevronRight className="h-5 w-5" />
      </span>
    </button>
  );
}
