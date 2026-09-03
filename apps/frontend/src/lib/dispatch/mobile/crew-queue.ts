// apps/frontend/src/lib/dispatch/mobile/crew-queue.ts
//
// spec-76 review I5 — "DESPUÉS DE ESTA" (2a) must not offer, as the next
// route to load, one 2b refuses to open. Extracted so the rule is testable
// on its own rather than only as an inline filter inside
// useCrewLoadingBoard.ts's queryFn.
import type { RouteCard } from './crew-board';

export function buildLoadableQueue(cards: readonly RouteCard[], excludeRouteId: string | null): RouteCard[] {
  return cards.filter((c) => c.id !== excludeRouteId && c.chip !== 'otra_cuadrilla');
}
