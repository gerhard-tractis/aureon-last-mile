import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';
import { decodeAuditEntry, meaningfulAuditEntries } from './audit-decoder';
import {
  decodePickupScan,
  pickupScanRouteLabel,
  type DossierPickupScan,
} from './pickup-scan-events';

/**
 * spec-65 Task 7's `buildEvents`, lifted out of `UnifiedEventLog` when the
 * pickup leg became a third event source and the component hit its 300-line
 * cap. Behaviour is unchanged for the two original sources.
 *
 * Pickup scans are AUREON events, not a third badge: they are our own
 * warehouse system recording work our own people did, exactly like
 * `audit_logs`. Only DispatchTrack is foreign, and only it gets the other
 * badge — so the existing Todo / Aureon / DispatchTrack filter keeps
 * meaning what it says.
 */
export type UnifiedEvent =
  | {
      source: 'aureon';
      kind: 'audit';
      id: string;
      timestamp: string | null;
      title: string;
      actor: string | null;
      raw: unknown;
    }
  | {
      source: 'aureon';
      kind: 'pickup';
      id: string;
      timestamp: string | null;
      title: string;
      actor: string | null;
      /** `pickup_routes.code` — the route the verification happened on. */
      routeLabel: string | null;
      packageLabel: string;
      raw: unknown;
    }
  | {
      source: 'dispatchtrack';
      kind: 'dispatch';
      id: string;
      timestamp: string | null;
      dispatch: DossierDispatch;
    };

function dispatchTimestamp(d: DossierDispatch): string | null {
  return d.completed_at ?? d.arrived_at ?? d.estimated_at ?? null;
}

/** Newest first; entries with no timestamp sink to the bottom in a stable order. */
function byTimestampDesc(a: UnifiedEvent, b: UnifiedEvent): number {
  if (!a.timestamp && !b.timestamp) return 0;
  if (!a.timestamp) return 1;
  if (!b.timestamp) return -1;
  return b.timestamp.localeCompare(a.timestamp);
}

export function buildUnifiedEvents(
  auditLogs: AuditEntry[],
  dispatches: DossierDispatch[],
  pickupScans: DossierPickupScan[] = [],
  packageLabels: Record<string, string> = {},
): UnifiedEvent[] {
  const auditEvents: UnifiedEvent[] = meaningfulAuditEntries(auditLogs).map((log) => ({
    source: 'aureon',
    kind: 'audit',
    id: log.id,
    timestamp: log.timestamp,
    // `log.action` is the trigger's own "UPDATE_orders" string, which told
    // an operator nothing. The decoder names the transition it actually was.
    title: decodeAuditEntry(log).title,
    actor: log.actorName ?? null,
    raw: log.changes_json,
  }));

  const pickupEvents: UnifiedEvent[] = pickupScans.map((scan) => {
    const decoded = decodePickupScan(scan, packageLabels);
    return {
      source: 'aureon',
      kind: 'pickup',
      id: scan.id,
      timestamp: scan.scanned_at,
      title: decoded.title,
      actor: scan.actorName ?? null,
      routeLabel: pickupScanRouteLabel(scan),
      packageLabel: decoded.packageLabel,
      raw: scan,
    };
  });

  const dispatchEvents: UnifiedEvent[] = dispatches.map((d) => ({
    source: 'dispatchtrack',
    kind: 'dispatch',
    id: d.id,
    timestamp: dispatchTimestamp(d),
    dispatch: d,
  }));

  return [...auditEvents, ...pickupEvents, ...dispatchEvents].sort(byTimestampDesc);
}

/** How many AUREON rows really exist, after housekeeping rows are dropped. */
export function aureonEventCount(
  auditLogs: AuditEntry[],
  pickupScans: DossierPickupScan[] = [],
): number {
  return meaningfulAuditEntries(auditLogs).length + pickupScans.length;
}
