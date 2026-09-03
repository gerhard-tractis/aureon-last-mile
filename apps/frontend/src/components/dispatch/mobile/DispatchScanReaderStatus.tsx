'use client';

import { cn } from '@/lib/utils';

/**
 * spec-76 decision 3 — "2e rotula el lector activo (ZEBRA TC22) porque la
 * cuadrilla necesita saber si el campo está armado." The device name is a
 * fixed label (a web page cannot introspect which handheld model is
 * plugged in as a keyboard wedge); "armed" reuses `ScanField`'s own
 * `onFocusStateChange` — the same mechanism reception's "Lector listo" /
 * "Toca para reactivar el lector" already uses (ScanField.tsx's own doc
 * comment), so this label never claims readiness the field itself has not
 * reported.
 */
export interface DispatchScanReaderStatusProps {
  armed: boolean;
}

export function DispatchScanReaderStatus({ armed }: DispatchScanReaderStatusProps) {
  return (
    <p
      className={cn(
        'font-mono text-[11px] font-semibold uppercase tracking-[.06em]',
        armed ? 'text-status-success-text' : 'text-status-warning-text',
      )}
    >
      ZEBRA TC22 · {armed ? 'LISTO' : 'TOCA PARA REACTIVAR'}
    </p>
  );
}
