/**
 * spec-80 fase 5 — pure helpers for `5i` ("carga cerrada").
 *
 * Kept out of the page component, same reasoning as reviewCloseGate.ts
 * (fase 2): a route's pending count and "next" manifest is a plain
 * filter/pick over data other hooks already fetch (`useActivePickupRoute`,
 * `useRouteManifests`) — no reason to make it depend on React or Supabase to
 * be testable.
 */

export interface PendingRouteManifest {
  id: string;
  status?: string | null;
  retailer_name: string | null;
}

export interface PendingRouteSummary {
  pendingCount: number;
  /** The retailer of the first manifest still pending — null when there is
   *  none left, or the next one has no retailer_name recorded yet. */
  nextManifestLabel: string | null;
}

/**
 * `closedManifestId` is excluded explicitly, not just by status — a
 * manifest whose `close_manifest` write has not reached this screen's
 * `useRouteManifests` cache yet (same query, invalidated on close but not
 * guaranteed to have refetched before this renders) must not count itself
 * as still pending.
 *
 * `useRouteManifests` already orders its result oldest-attached-first (see
 * that hook's own comment) — the first manifest left pending in that order
 * is "next" in the same sense `NextManifestCard` already uses on the active
 * route screen.
 */
/**
 * "3 cargas pendientes" / "1 carga pendiente" — same singular/singular-noun
 * concordance rule fase 2 already applied to "Falta 1 paquete" (never
 * "Faltan 1 paquetes"). `n` is never rendered for 0 — the caller omits the
 * whole "Sigue en PR-…" block in that case (an empty route has nothing to
 * "sigue en").
 */
export function pendingLoadsLabel(n: number): string {
  return n === 1 ? '1 carga pendiente' : `${n} cargas pendientes`;
}

export function summarizePendingRouteManifests(
  manifests: PendingRouteManifest[],
  closedManifestId: string,
): PendingRouteSummary {
  const pending = manifests.filter(
    (m) => m.id !== closedManifestId && m.status !== 'completed',
  );
  return {
    pendingCount: pending.length,
    nextManifestLabel: pending[0]?.retailer_name ?? null,
  };
}
