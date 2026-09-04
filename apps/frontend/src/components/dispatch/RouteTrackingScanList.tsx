'use client';

import { TIMEZONE, LOCALE } from '@/lib/utils/dateFormat';
import type { ScanEntry } from '@/lib/dispatch/route-tracking';

interface Props {
  scans: ScanEntry[];
}

function formatScanTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
}

/**
 * spec-75 phase 4 (`1c`) — the scan list, newest first: running index,
 * barcode, order + comuna, address + client, time.
 *
 * Rejected reads (`Ya está en RUT-2026-0087 · no se agregó`, `orden
 * incompleta`) are NOT rendered here — decision 12 / spec-79 H4. Neither
 * scan endpoint (`routes/[id]/scan`, `load-positions/scan`) persists a
 * rejection: the `dock_scans` insert is hardcoded `scan_result: 'accepted'`
 * and only runs after validation passes, so there is nowhere honest to
 * read a rejection from today. This list is accepted loads only.
 */
export function RouteTrackingScanList({ scans }: Props) {
  if (scans.length === 0) {
    return <p className="px-5 py-6 text-[13px] text-text-muted">Todavía no hay paquetes escaneados.</p>;
  }

  return (
    <ul className="flex-1 overflow-y-auto divide-y divide-border">
      {scans.map((scan, i) => (
        <li key={scan.packageId} className="flex items-start gap-3 px-5 py-2.5">
          <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[11px] text-text-muted">
            {scans.length - i}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[12.5px] text-text">{scan.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-text-muted">{formatScanTime(scan.loadedAtIso)}</span>
            </div>
            <p className="truncate text-[12.5px] text-text-secondary">
              {scan.orderNumber}
              {scan.comuna && <> · {scan.comuna}</>}
            </p>
            {(scan.address || scan.customerName) && (
              <p className="truncate text-[11.5px] text-text-muted">
                {scan.address}
                {scan.address && scan.customerName && ' · '}
                {scan.customerName}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
