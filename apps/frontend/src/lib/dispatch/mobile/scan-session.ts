// apps/frontend/src/lib/dispatch/mobile/scan-session.ts
//
// spec-76 phase 4 (2e/2f) — pure shaping for the continuous scan loop's
// client-only session state. NOTHING here is persisted: the scan endpoint
// (POST /api/dispatch/routes/[id]/scan) writes an accepted package's
// `loaded_at`, but a REJECTED scan writes nothing anywhere — verified by
// reading route.ts and scan-validator.ts, neither of which touches
// `dock_scans` or any other table on the failure path. So `history` here is
// this browser tab's own memory: gone on refresh, and never a source of
// truth for anything beyond "what did I just see". Persisting rejections is
// spec-79 H4, not this task.
import { rejectionCopy, type ScanRejectionCode } from './scan-rejection-copy';
import { TIMEZONE, LOCALE } from '@/lib/utils/dateFormat';

/** "09:19:04" — HH:MM:SS in the nave's civil timezone (dateFormat.ts's
 *  `formatDateTime` always carries the date too; the scan loop only ever
 *  shows "today", so the date half would be dead weight on every row). */
export function formatScanTimestamp(atIso: string): string {
  return new Date(atIso).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TIMEZONE,
  });
}

export interface AcceptedScanEntry {
  kind: 'accepted';
  id: string;
  code: string;
  atIso: string;
  orderId: string;
  orderNumber: string;
  contactName: string | null;
  contactAddress: string | null;
  /** null when the route-scan-context fetch hasn't resolved this order yet
   *  — never a guess. */
  comuna: string | null;
  retailerName: string | null;
  stopIndex: number | null;
  boxesLoaded: number | null;
  boxesTotal: number | null;
}

export interface RejectedScanEntry {
  kind: 'rejected';
  id: string;
  code: string;
  atIso: string;
  rejectionCode: ScanRejectionCode;
  title: string;
  tallyLabel: string;
  /** Short inline label for the "ÚLTIMAS LECTURAS" row, e.g. "YA EN RUT-0087". */
  historyLabel: string;
  canViewConflictingRoute: boolean;
  conflictingRouteId: string | null;
}

export type ScanHistoryEntry = AcceptedScanEntry | RejectedScanEntry;

interface OrderContext {
  comuna: string | null;
  retailerName: string | null;
  stopIndex: number | null;
}

interface BoxCounts {
  loaded: number;
  total: number;
}

export function buildAcceptedEntry(input: {
  id: string;
  code: string;
  atIso: string;
  response: {
    order_id: string;
    order_number: string;
    contact_name: string | null;
    contact_address: string | null;
  };
  orderContext?: OrderContext;
  boxes?: BoxCounts;
}): AcceptedScanEntry {
  return {
    kind: 'accepted',
    id: input.id,
    code: input.code,
    atIso: input.atIso,
    orderId: input.response.order_id,
    orderNumber: input.response.order_number,
    contactName: input.response.contact_name,
    contactAddress: input.response.contact_address,
    comuna: input.orderContext?.comuna ?? null,
    retailerName: input.orderContext?.retailerName ?? null,
    stopIndex: input.orderContext?.stopIndex ?? null,
    boxesLoaded: input.boxes?.loaded ?? null,
    boxesTotal: input.boxes?.total ?? null,
  };
}

export function buildRejectedEntry(input: {
  id: string;
  code: string;
  atIso: string;
  failure: { code: ScanRejectionCode; message: string; conflictingRouteId?: string | null };
  conflictingRouteCode?: string | null;
}): RejectedScanEntry {
  const copy = rejectionCopy({
    code: input.failure.code,
    message: input.failure.message,
    conflictingRouteCode: input.conflictingRouteCode ?? null,
  });
  return {
    kind: 'rejected',
    id: input.id,
    code: input.code,
    atIso: input.atIso,
    rejectionCode: input.failure.code,
    title: copy.title,
    tallyLabel: copy.tallyLabel,
    historyLabel: copy.historyLabel,
    canViewConflictingRoute: copy.canViewConflictingRoute,
    conflictingRouteId: input.failure.conflictingRouteId ?? null,
  };
}

export function countRejections(entries: readonly ScanHistoryEntry[]): number {
  return entries.filter((e) => e.kind === 'rejected').length;
}

/**
 * spec-76 review Important #2. `ScanField` is deliberately ungated while a
 * scan is in flight (DispatchRouteScanSession's own comment) — matching the
 * design's "no per-package confirmation" intent — so two scans overlap
 * routinely: a slow first scan and a fast second one resolve out of order.
 * A blind prepend on every `onSuccess`/`onError` would let the slow one's
 * late arrival jump back in front of the fast one's already-shown result,
 * and derive `lastEntry` from array position rather than from time. Insert
 * by `atIso` instead, keeping the list newest-first regardless of
 * resolution order.
 */
export function insertByAtIso(
  entries: readonly ScanHistoryEntry[],
  entry: ScanHistoryEntry,
): ScanHistoryEntry[] {
  const idx = entries.findIndex((e) => e.atIso <= entry.atIso);
  if (idx === -1) return [...entries, entry];
  return [...entries.slice(0, idx), entry, ...entries.slice(idx)];
}

/** The entry with the greatest `atIso` — what the "last read" card shows.
 *  Computed by value, not by array position, so it stays correct even if a
 *  caller ever accumulates `history` some other way than `insertByAtIso`. */
export function latestEntry(entries: readonly ScanHistoryEntry[]): ScanHistoryEntry | null {
  if (entries.length === 0) return null;
  return entries.reduce((latest, e) => (e.atIso > latest.atIso ? e : latest));
}

/**
 * spec-76 review Important #3. `packages` (useRoutePackages) is stale until
 * its cache-invalidation refetch lands, and stays stale for the NEXT scan
 * too if two boxes of the same order are scanned faster than that refetch
 * — so a query-based "+1" renders the same "paquete 2 de 3" for both boxes.
 * Counting this session's own already-accepted entries for the order is
 * immune to query timing: it only ever grows by exactly one per accepted
 * scan of that order, exactly when a new one lands.
 */
export function countAcceptedForOrder(entries: readonly ScanHistoryEntry[], orderId: string): number {
  return entries.filter((e) => e.kind === 'accepted' && e.orderId === orderId).length;
}

export interface RejectionTallyRow {
  code: ScanRejectionCode;
  label: string;
  count: number;
}

/** "OTROS MOTIVOS DE RECHAZO" — grouped counts, most frequent reason first,
 *  ties broken by first-seen order for a stable render. */
export function tallyRejections(entries: readonly ScanHistoryEntry[]): RejectionTallyRow[] {
  const order: ScanRejectionCode[] = [];
  const counts = new Map<ScanRejectionCode, { label: string; count: number }>();
  for (const e of entries) {
    if (e.kind !== 'rejected') continue;
    const existing = counts.get(e.rejectionCode);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(e.rejectionCode, { label: e.tallyLabel, count: 1 });
      order.push(e.rejectionCode);
    }
  }
  return order
    .map((code) => ({ code, ...counts.get(code)! }))
    .sort((a, b) => b.count - a.count);
}
