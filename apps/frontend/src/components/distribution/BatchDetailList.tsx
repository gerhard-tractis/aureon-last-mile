'use client';

import { CheckCircle, XCircle } from 'lucide-react';
import type { DockScanRecord } from '@/hooks/distribution/useDockScans';

interface BatchDetailListProps {
  scans: DockScanRecord[];
  totalExpected: number;
}

export function BatchDetailList({ scans, totalExpected }: BatchDetailListProps) {
  const acceptedCount = scans.filter(s => s.scan_result === 'accepted').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Paquetes escaneados</h2>
        <span className="text-lg font-semibold tabular-nums">
          {acceptedCount} / {totalExpected}
        </span>
      </div>

      {scans.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Ningún paquete escaneado todavía.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {scans.map((scan) => (
            <li key={scan.id} className="flex items-center gap-3 px-3 py-2">
              {scan.scan_result === 'accepted' ? (
                <CheckCircle className="h-4 w-4 text-status-success shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-status-error shrink-0" />
              )}
              <span className="font-mono text-sm flex-1">{scan.barcode}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(scan.scanned_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
