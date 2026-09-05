// apps/frontend/src/lib/dispatch/mobile/route-close.ts
//
// spec-77 Fase 1 (UI) — `2i`, "Cerrar con faltantes". Pure row-shaping over
// the same `RoutePackage[]` `useRouteScanSession`/`useRoutePackages` already
// fetch — no new query. An order counts as "sin cargar" the same way
// `PackageRow.tsx`/`seal-route.ts` already do: `boxesLoaded < boxesTotal`
// (both already filtered to the seal's DISPATCHABLE_STATUSES upstream in
// `useRoutePackages.ts`), never `dispatches.status`/`packages.status`
// directly — this module never re-derives the load fact, only sums it.
import type { RoutePackage } from '@/lib/dispatch/types';
import type { ForceSealReasonCode } from '@/lib/dispatch/force-seal-reasons';

export interface MissingOrder {
  orderId: string;
  orderNumber: string;
  contactName: string | null;
  missingCount: number;
}

/** decision 3 / item 3 & 8 — one row per order still short a box, with the
 * exact shortfall so the confirmation screen can both list it and sum the
 * total that drives `closeButtonLabel`. */
export function missingOrders(packages: readonly RoutePackage[]): MissingOrder[] {
  return packages
    .filter((p) => p.boxesLoaded < p.boxesTotal)
    .map((p) => ({
      orderId: p.order_id,
      orderNumber: p.order_number,
      contactName: p.contact_name,
      missingCount: p.boxesTotal - p.boxesLoaded,
    }));
}

/** decision 1 — the destructive action names the exact figure, never a bare
 * "¿Confirmar cierre?". `0` is the direct-close path (item 3): nothing is
 * missing, so there is nothing to force, and the button reverts to the
 * plain label. */
export function closeButtonLabel(missingBoxCount: number): string {
  return missingBoxCount > 0 ? `Cerrar con ${missingBoxCount} sin cargar` : 'Cerrar ruta';
}

/** decision 3 — paginated, not the full list: `visible` is capped at
 * `limit`, `remaining` is what "Ver los N restantes" names. */
export function paginateMissing<T>(
  rows: readonly T[],
  limit: number,
): { visible: T[]; remaining: number } {
  const visible = rows.slice(0, limit);
  const remaining = Math.max(0, rows.length - limit);
  return { visible, remaining };
}

/**
 * decision 4 — "nota por paquete, opcional en UI y sin regla de servidor
 * inventada". `POST /seal`'s force path carries exactly one `note` string
 * for the whole call (`resolvePendingStops`/`writeForceSealAudit`) — there
 * is no per-order note column, and this phase carries no migration. Rather
 * than inventing client-only storage that silently drops on refresh, every
 * per-row note that was actually typed is folded into that single string,
 * tagged with the order number so the audit trail stays legible; the
 * reason's own free-text note (required only for `otro`,
 * `force-seal-reason-copy.ts`'s `requiresNote`) comes first when present.
 * A row left untouched contributes nothing — its absence never blocks the
 * close (item 7).
 */
export function buildForceSealNote(
  reasonCode: ForceSealReasonCode,
  globalNote: string,
  rowNotes: ReadonlyMap<string, string>,
  orders: readonly MissingOrder[],
): string | undefined {
  const lines: string[] = [];
  const trimmedGlobal = globalNote.trim();
  if (trimmedGlobal) lines.push(trimmedGlobal);

  for (const order of orders) {
    const note = rowNotes.get(order.orderId)?.trim();
    if (note) lines.push(`${order.orderNumber}: ${note}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}
