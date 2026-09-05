// apps/frontend/src/lib/dispatch/mobile/route-close.ts
//
// spec-77 Fase 1 (UI) — `2i`, "Cerrar con faltantes". Pure row-shaping over
// the same `RoutePackage[]` `useRouteScanSession`/`useRoutePackages` already
// fetch — no new query.
//
// B3 (adversarial review of `2i`) — an order counts as "sin cargar" by
// `dispatches.stage`, the same fact the server's own pending definition
// (`route_stop_counts.pending_stops + partially_staged_stops`, read by
// `sealRoute`/`resolvePendingStops`) reduces to: `stage IN ('planned',
// 'partially_staged')`. This module used to decide via `boxesLoaded <
// boxesTotal` instead — a second, independent count that diverges from the
// server's in both directions:
//   - an order with a sibling bulto at `en_bodega` (not in
//     DISPATCHABLE_STATUSES, so `useRoutePackages` never counts it into
//     `boxesTotal` at all) can read "N of N" here while `dispatches.stage`
//     is still `partially_staged` server-side — the screen said "nothing
//     missing", took the direct-close path, and the server's `409
//     UNSEALED_STOPS` fired into what was (B2) a silently discarded
//     outcome.
//   - an `adopted`/`force_split` order with no countable live package gets
//     `boxesTotal` floored to 1 by `useRoutePackages` (so a non-`staged`
//     order never reads "0 of 0") — read via `boxesLoaded < boxesTotal`
//     that floor manufactured a phantom missing box for an order the
//     server has already resolved and will never refuse over.
// `stage` is a fact the server itself writes (`recompute_dispatch_stage`)
// and `useRoutePackages` already returns unmodified on every `RoutePackage`
// — reading it here needs no change to that hook (owned by a concurrent
// branch right now), and removes this module's own copy of a rule that
// only the server should define.
import type { RoutePackage } from '@/lib/dispatch/types';
import type { ForceSealReasonCode } from '@/lib/dispatch/force-seal-reasons';

export interface MissingOrder {
  orderId: string;
  orderNumber: string;
  contactName: string | null;
  missingCount: number;
}

const PENDING_STAGES: ReadonlySet<RoutePackage['stage']> = new Set(['planned', 'partially_staged']);

/** decision 3 / item 3 & 8 — one row per order the server still considers
 * pending, with a shortfall count so the confirmation screen can both list
 * it and sum the total that drives `closeButtonLabel`. Floored at 1: a
 * pending stage is itself proof at least one box is outstanding, even when
 * the box-level arithmetic (which counts a narrower status set than
 * `recompute_dispatch_stage` does) happens to read zero for this order —
 * "0 sin cargar" on a row the sheet is about to force past would be a lie. */
export function missingOrders(packages: readonly RoutePackage[]): MissingOrder[] {
  return packages
    .filter((p) => PENDING_STAGES.has(p.stage))
    .map((p) => ({
      orderId: p.order_id,
      orderNumber: p.order_number,
      contactName: p.contact_name,
      missingCount: Math.max(p.boxesTotal - p.boxesLoaded, 1),
    }));
}

/** MEDIUM (adversarial review) — grammatical singular/plural, and the dock
 * phrase built once instead of interpolated inside a literal that already
 * said "el andén" (which produced "el andén el andén" whenever the route
 * has no load position). */
export function missingBoxesLine(missingBoxCount: number, loadPositionLabel: string | null): string {
  const dockPhrase = loadPositionLabel ? `el andén ${loadPositionLabel}` : 'el andén';
  return missingBoxCount === 1
    ? `El paquete se queda en ${dockPhrase} y hay que meterlo en otra ruta.`
    : `Los ${missingBoxCount} paquetes se quedan en ${dockPhrase} y hay que meterlos en otra ruta.`;
}

/** MEDIUM (adversarial review) — same singular fix for the second
 * consequence line. */
export function loadedBoxesLine(packagesLoaded: number): string {
  return packagesLoaded === 1
    ? 'El paquete cargado pasa a listo para despacho.'
    : `Los ${packagesLoaded} cargados pasan a listo para despacho.`;
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
