'use client';

import { Lock } from 'lucide-react';
import type { RouteCard, RouteCardChip } from '@/lib/dispatch/mobile/crew-board';

const CHIP_LABEL: Record<RouteCardChip, string> = {
  tu_carga: 'TU CARGA',
  borrador: 'BORRADOR',
  lista: 'LISTA',
  otra_cuadrilla: 'EN CARGA',
};

const ACTION_LABEL: Record<Exclude<RouteCardChip, 'otra_cuadrilla'>, string> = {
  tu_carga: 'Continuar carga',
  borrador: 'Abrir y asignar vehículo',
  // spec-76 review I6 — this used to say "Despachar", but the action
  // navigates to 2c, the pre-scan screen, not to the actual (irreversible)
  // dispatch call. Dispatch is spec-77.
  lista: 'Abrir',
};

/**
 * spec-76 2b — one route card. A route another crew is loading (spec-76
 * decision 9) renders but does NOT open: no `onClick` anywhere on it, so it
 * is inert rather than a dead click target.
 *
 * spec-76 Lecciones aplicadas #4/#6 — this is exactly the "tappable card
 * with an action button inside" trap. The card is a plain `div` (never
 * `role="button"`), the action is a native `<button>` sibling inside it,
 * and its click handler calls `stopPropagation()` so the card's own
 * `onClick` (also `onOpen`, so both paths do the same thing) never double-
 * fires. `DispatchCrewRouteCard.test.tsx` asserts the card is not exposed
 * as a button and that the action fires exactly once.
 */
export interface DispatchCrewRouteCardProps {
  route: RouteCard;
  onOpen: (routeId: string) => void;
}

export function DispatchCrewRouteCard({ route, onOpen }: DispatchCrewRouteCardProps) {
  const isOpenable = route.chip !== 'otra_cuadrilla';
  const comunaLabel = route.comuna
    ? route.otherComunaCount > 0
      ? `${route.comuna} +${route.otherComunaCount}`
      : route.comuna
    : 'Sin comuna';

  return (
    // spec-76 review M8 — this `onClick` needs no keyboard equivalent: it
    // is not itself a tab stop (no role, no tabIndex), so a keyboard user
    // reaches the same action through the inner `<button>` below, which
    // already fires it.
    <div
      data-testid="dispatch-crew-route-card"
      onClick={isOpenable ? () => onOpen(route.id) : undefined}
      className={`rounded-[12px] border border-border bg-surface p-3.5 ${isOpenable ? 'cursor-pointer active:opacity-90' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13.5px] font-semibold text-text">{route.code}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-text-secondary">
          {CHIP_LABEL[route.chip]}
        </span>
      </div>

      <p className="mt-1 text-[12.5px] text-text-secondary">
        {comunaLabel} · {route.packagesLoaded}/{route.packagesTotal} paquetes
        {route.loadPositionLabel ? ` · ${route.loadPositionLabel}` : ''}
      </p>

      {route.chip === 'otra_cuadrilla' ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-text-muted">
          <Lock className="h-3.5 w-3.5" />
          la está cargando {route.loadedByOtherName ?? 'otra persona'}
        </p>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(route.id);
          }}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[8px] bg-accent-light text-[13.5px] font-semibold text-accent-light-foreground active:opacity-90"
        >
          {ACTION_LABEL[route.chip]}
        </button>
      )}
    </div>
  );
}
