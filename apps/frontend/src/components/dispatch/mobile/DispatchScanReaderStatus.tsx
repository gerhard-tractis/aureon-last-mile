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
 *
 * spec-78 review — `size`, `'lg'` for `3a`: decision 4 there calls this
 * line "información de primera clase" (it is what stops boxes being
 * passed in vain when focus was lost on a mounted device nobody is
 * holding), so it cannot stay at 2e's 11px. `'md'` is the exact
 * pre-existing size, unchanged.
 */
export interface DispatchScanReaderStatusProps {
  armed: boolean;
  size?: 'md' | 'lg';
}

const TEXT_SIZE = { md: 'text-[11px]', lg: 'text-[15px]' } as const;

export function DispatchScanReaderStatus({ armed, size = 'md' }: DispatchScanReaderStatusProps) {
  return (
    <p
      className={cn(
        'font-mono font-semibold uppercase tracking-[.06em]',
        TEXT_SIZE[size],
        armed ? 'text-status-success-text' : 'text-status-warning-text',
      )}
    >
      ZEBRA TC22 · {armed ? 'LISTO' : 'TOCA PARA REACTIVAR'}
    </p>
  );
}
