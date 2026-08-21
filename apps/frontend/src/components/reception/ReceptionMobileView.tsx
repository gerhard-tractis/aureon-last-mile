'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { ReceptionMobileHeader } from './ReceptionMobileHeader';
import { ReceptionMobileYardCard } from './ReceptionMobileYardCard';
import { ReceptionMobileCompactRow } from './ReceptionMobileCompactRow';
import { ReceptionMobileFooterActions } from './ReceptionMobileFooterActions';
import { ReceiveWithoutQRSheet } from './ReceiveWithoutQRSheet';
import { minutesSince } from '@/lib/reception/reception-mobile-helpers';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';
import type { OpenDiscrepancy } from '@/hooks/reception/useOpenDiscrepancies';

/**
 * spec-62 3i — the mobile Recepción yard screen: an andén operator standing
 * up, unloading one truck at a time.
 *
 * The one decision this screen makes for the operator: the hero card is the
 * yard route that has waited *longest*, not the first entry in `yardRoutes`
 * nor the newest arrival. Every other yard route is a compact row — "las
 * demás rutas son filas, no decisiones" (mock 3i). `waitingMinutes` is
 * computed once, here, via `minutesSince` and handed down as a plain number
 * so the hero and the rows share one clock read instead of drifting apart.
 *
 * Deliberately absent, per the mock's field constraints: KPI tiles (the
 * shift average lives on the supervisor's desktop screen, 3c) and a theme
 * switcher. No control on this screen competes with the hero's own
 * "Iniciar conteo" — starting a count is the only primary action.
 *
 * Nothing here calls `open_route_reception`. Tapping the hero or a row only
 * invokes `onStartCount`, a plain callback the page turns into navigation;
 * the footer's "Recibir sin QR" opens `ReceiveWithoutQRSheet`, which owns
 * the confirmed manual-entry path into that mutation.
 */
export interface ReceptionMobileViewProps {
  /** Rutas en patio (`in_transit`), con su recepción ya abierta. */
  yardRoutes: IncomingRoute[];
  /** Rutas todavía en camino (`in_progress`) — la población del fallback sin QR. */
  transitRoutes: IncomingRoute[];
  discrepancies: OpenDiscrepancy[];
  isLoading: boolean;
  userName: string | null;
  /**
   * Fires both from the hero card's "Iniciar conteo" and from tapping any
   * compact row — a row and the hero lead to the same place (the route's
   * count), so they deliberately share this one callback rather than two
   * names for one destination.
   */
  onStartCount: (routeId: string) => void;
  onOpenQRScanner: () => void;
  onOpenDiscrepancy: (routeId: string) => void;
  /**
   * El bloque de reingresos que hoy vive en la pestaña Retornos del
   * escritorio (`ReturnRouteList` / `ReturnReceptionSession`). Llega como
   * slot porque su estado — qué ruta está seleccionada — es de la página, y
   * porque los dos árboles montan exactamente el mismo bloque.
   */
  returnsSlot?: ReactNode;
  /** Inyectable para los tests. */
  now?: Date;
}

export function ReceptionMobileView({
  yardRoutes,
  transitRoutes,
  discrepancies,
  isLoading,
  userName,
  onStartCount,
  onOpenQRScanner,
  onOpenDiscrepancy,
  returnsSlot,
  now,
}: ReceptionMobileViewProps) {
  const [noQrOpen, setNoQrOpen] = useState(false);

  // Sort ascending by in_transit_at (oldest first) so index 0 is the truck
  // that has waited longest — the one decision this screen makes. A route
  // with no in_transit_at (should not happen for `in_transit` routes, but
  // never crash on it) sorts last rather than winning the hero slot.
  const sortedYardRoutes = useMemo(() => {
    return [...yardRoutes].sort((a, b) => {
      const aTime = a.in_transit_at ? new Date(a.in_transit_at).getTime() : Infinity;
      const bTime = b.in_transit_at ? new Date(b.in_transit_at).getTime() : Infinity;
      return aTime - bTime;
    });
  }, [yardRoutes]);

  const [hero, ...rest] = sortedYardRoutes;
  const clock = now ?? new Date();

  return (
    <div className="flex flex-col gap-4">
      <ReceptionMobileHeader userName={userName} />

      {isLoading ? (
        // Built from the hero card's OWN structural classes (rounded-2xl
        // border-2 p-5, the h-16 button) with stacked inner Skeleton blocks
        // standing in for its text lines — never a centred spinner (mock 3i
        // field constraint). Deriving the shape this way means it cannot
        // drift from the real card the way a hardcoded height constant
        // would the next time ReceptionMobileYardCard's typography changes.
        <div
          data-testid="reception-yard-hero-skeleton"
          className="rounded-2xl border-2 border-accent bg-accent-muted p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-5 w-14" />
          </div>
          <Skeleton className="mt-2 h-[30px] w-40" />
          <Skeleton className="mt-2 h-5 w-48" />
          <Skeleton className="mt-3 h-4 w-36" />
          <Skeleton className="mt-4 h-16 w-full rounded-[14px]" />
        </div>
      ) : hero ? (
        <>
          <div data-testid="reception-yard-hero">
            <ReceptionMobileYardCard
              route={hero}
              waitingMinutes={minutesSince(hero.in_transit_at, clock)}
              onStart={() => onStartCount(hero.id)}
            />
          </div>

          {rest.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs tracking-[.1em] text-text-secondary">
                TAMBIÉN EN PATIO
              </p>
              {rest.map((route) => (
                <ReceptionMobileCompactRow
                  key={route.id}
                  route={route}
                  waitingMinutes={minutesSince(route.in_transit_at, clock)}
                  onOpen={() => onStartCount(route.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={ArrowUpDown}
          title="Ningún camión en patio"
          description="Cuando llegue un camión, escanea el QR de su ruta para abrir el conteo."
        />
      )}

      {discrepancies.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-status-error-border bg-status-error-bg p-3.5">
          <p className="font-mono text-xs tracking-[.1em] text-status-error-text">
            DIFERENCIAS ABIERTAS
          </p>
          {discrepancies.map((discrepancy) => (
            <div key={discrepancy.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text">
                  {discrepancy.routeCode}
                </p>
                <p className="text-[12.5px] text-text-secondary">
                  {discrepancy.received} de {discrepancy.expected} paquetes
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenDiscrepancy(discrepancy.routeId)}
                className="min-h-11 flex-none rounded-lg border border-status-error-border bg-surface px-3.5 text-[13px] font-semibold text-status-error-text transition-colors active:bg-status-error-bg"
              >
                Resolver
              </button>
            </div>
          ))}
        </section>
      )}

      {returnsSlot && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-[.1em] text-text-secondary">REINGRESOS</p>
          {returnsSlot}
        </div>
      )}

      <ReceptionMobileFooterActions onScanQR={onOpenQRScanner} onNoQR={() => setNoQrOpen(true)} />

      <ReceiveWithoutQRSheet open={noQrOpen} onOpenChange={setNoQrOpen} routes={transitRoutes} />
    </div>
  );
}
