'use client';

import { ScanLine } from 'lucide-react';
import { DistributionMobileHeader, useIsOnline } from './DistributionMobileHeader';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import { cn } from '@/lib/utils';
import type { QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

/**
 * spec-68 Fase 5.2 — `4g`, quicksort step 1, below `lg`.
 *
 * Top to bottom: titled header (operator · paso 1 de 2 · N escaneos hoy,
 * connection chip), the dashed-accent scan panel, the session counter row,
 * ÚLTIMOS ESCANEOS, and the fixed footer (Ingresar código / Cerrar lote).
 *
 * "N escaneos hoy" reads `sessionCount` — the same session counter
 * `useQuickSortFlow` already tracks. There is no server-side "scans today"
 * query in this codebase (Decisión 9's pattern: don't invent one for a
 * number the session count already answers close enough for), and turnos
 * don't exist in the schema either (Decisión 9, `4c`).
 */
export interface QuickSortMobileProps {
  operatorName: string | null;
  sessionCount: number;
  scans: QuickSortScanEvent[];
  error: string | null;
  onScan: (code: string) => void;
  onBack: () => void;
  /** Injectable for tests; defaults to `navigator.onLine` via
   *  `useIsOnline` (review fix #3 — was a hardcoded 'EN LÍNEA'). */
  isOnline?: boolean;
  /** Footer "Ingresar código" — focuses the scan field for manual keyboard
   *  entry (the field IS a text input; scanning it into the DOM is what a
   *  scanner gun already does). No separate keypad in this codebase. */
  onEnterCode: () => void;
  /** Footer "Cerrar lote" — ends the session and returns to Distribución. */
  onCloseBatch: () => void;
}

function timeLabel(at: Date): string {
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function QuickSortMobile({
  operatorName,
  sessionCount,
  scans,
  error,
  onScan,
  onBack,
  onEnterCode,
  onCloseBatch,
  isOnline: isOnlineOverride,
}: QuickSortMobileProps) {
  const isOnline = useIsOnline(isOnlineOverride);
  return (
    <div className="flex min-h-0 flex-col gap-5 px-5 py-[22px] pb-[104px]">
      <DistributionMobileHeader
        variant="titled"
        title="Clasificación en andén"
        subtitle={`${operatorName ?? 'Operario'} · paso 1 de 2 · ${sessionCount} escaneos hoy`}
        onBack={onBack}
        statusChip={
          isOnline
            ? { label: 'EN LÍNEA', tone: 'success' }
            : { label: 'SIN CONEXIÓN', tone: 'error' }
        }
      />

      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-accent-muted px-5 py-8 text-center">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-accent">
          PASO 1 · PAQUETE
        </span>
        <ScanLine className="h-9 w-9 text-accent" aria-hidden="true" />
        <p className="font-heading text-[17px] font-semibold leading-tight text-text">
          Escanea el paquete
        </p>
        <p className="text-[12.5px] leading-[1.4] text-text-secondary">
          El sistema te dirá a qué andén va antes de que lo muevas
        </p>
        <ScanField
          ariaLabel="Escanear paquete"
          size="sm"
          onScan={onScan}
          className="w-full"
        />
      </div>

      {error && <ScanResult status="error" title={error} />}

      <div
        data-testid="quicksort-session-counter"
        className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5"
      >
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-text-muted">
          En esta sesión
        </span>
        <span className="font-mono text-[15px] font-bold text-text">{sessionCount}</span>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[.12em] text-text-muted">
          Últimos escaneos
        </h2>

        {scans.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-3.5 py-6 text-center text-[12.5px] text-text-secondary">
            Los escaneos de esta sesión aparecen aquí.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {scans.slice(0, 8).map((scan, i) => (
              <div
                key={`${scan.code}-${i}`}
                data-testid="quicksort-recent-scan"
                className={cn(
                  'flex min-h-[44px] items-center gap-2.5 rounded-lg border px-3 py-2',
                  scan.status === 'error'
                    ? 'border-status-error-border bg-status-error-bg'
                    : 'border-border bg-surface',
                )}
              >
                <span
                  className={cn(
                    'truncate font-mono text-[12px] font-semibold',
                    scan.status === 'error' ? 'text-status-error-text' : 'text-text',
                  )}
                >
                  {scan.code}
                </span>
                {scan.status === 'error' ? (
                  <span className="ml-auto flex-none font-mono text-[10.5px] font-semibold text-status-error-text">
                    {scan.reason ?? 'ERROR'}
                  </span>
                ) : (
                  <span className="ml-auto flex-none font-heading text-[12px] font-semibold text-status-success-text">
                    {scan.zoneCode}
                  </span>
                )}
                <span className="flex-none font-mono text-[10.5px] font-medium text-text-muted">
                  {timeLabel(scan.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onEnterCode}
          className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface text-[14px] font-medium text-text transition-colors active:bg-surface-raised"
        >
          Ingresar código
        </button>
        <button
          type="button"
          onClick={onCloseBatch}
          className="flex h-[56px] flex-1 items-center justify-center rounded-xl bg-accent-light text-[14px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
        >
          Cerrar lote
        </button>
      </div>
    </div>
  );
}
