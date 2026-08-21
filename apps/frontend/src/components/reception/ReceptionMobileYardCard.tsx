'use client';

import { Barcode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { waitLabel } from '@/lib/reception/reception-mobile-helpers';
import { YARD_WAIT_WARNING_MINUTES } from '@/app/app/reception/arrivals';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

/**
 * spec-62 3i — the hero card of the mobile Recepción yard screen.
 *
 * Takes the raw `IncomingRoute`, not an `ArrivalRow` (`buildArrivals` drops
 * `plate`): the plate is what the receptionist physically checks against
 * the truck in front of them before starting the count, so it must survive
 * onto this card. `waitingMinutes` arrives pre-computed by the page (Task
 * 12) — this component never calls `minutesSince` itself, so the whole
 * screen shares one clock read instead of drifting between cards.
 *
 * `onStart` is a plain callback, not a mutation. This card never calls
 * `open_route_reception` — that RPC ends the driver's trip and is only
 * reachable from a QR scan or the confirmed no-QR fallback. The page turns
 * this callback into navigation toward that flow.
 */
export interface ReceptionMobileYardCardProps {
  route: IncomingRoute;
  waitingMinutes: number | null;
  onStart: () => void;
}

export function ReceptionMobileYardCard({
  route,
  waitingMinutes,
  onStart,
}: ReceptionMobileYardCardProps) {
  const overdue = waitingMinutes !== null && waitingMinutes >= YARD_WAIT_WARNING_MINUTES;
  const wait = waitLabel(waitingMinutes);

  return (
    <div className="rounded-2xl border-2 border-accent bg-accent-muted p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-xs tracking-[.1em] text-text-secondary">
          EN PATIO ESPERANDO
        </p>
        {wait && (
          <span
            data-testid="yard-card-wait-badge"
            className={cn(
              'rounded px-1.5 py-1 font-mono text-[11px] font-semibold leading-none',
              overdue
                ? 'border border-status-error-border bg-status-error-bg text-status-error-text'
                : 'border border-border bg-surface-raised text-text-secondary',
            )}
          >
            {wait}
          </span>
        )}
      </div>

      <p className="mt-1 font-mono text-[30px] font-bold text-text">{route.code}</p>

      <p data-testid="yard-card-driver" className="mt-1 text-base text-text-body">
        {route.driver_name}
        {route.plate ? ` · ${route.plate}` : ''}
      </p>

      <p className="mt-3 text-sm text-text-secondary">
        <span className="font-mono text-[17px] font-semibold text-text">
          {route.expected_packages}
        </span>{' '}
        paquetes esperados
      </p>

      <button
        type="button"
        onClick={onStart}
        className="mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-[14px] bg-accent-light font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
      >
        <Barcode className="h-5 w-5" aria-hidden="true" />
        Iniciar conteo
      </button>
    </div>
  );
}
