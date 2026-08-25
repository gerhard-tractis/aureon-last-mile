'use client';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import { useQuickSortFlow, type QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

export type { QuickSortScanEvent };

interface QuickSortScannerProps {
  operatorId: string;
  userId: string;
  zones: DockZone[];
  /** Feeds the "Últimos escaneos" panel alongside this console. */
  onScanEvent?: (event: QuickSortScanEvent) => void;
}

/**
 * spec-68 Fase 5.1 — the desktop presentation of the quicksort scan loop.
 * The state machine itself lives in `useQuickSortFlow` (Fase 5.1): the
 * mobile step-1/step-2 screens (`QuickSortMobile`, `QuickSortMobileDock`)
 * consume the same hook so the two presentations can never drift apart.
 * This component's own behaviour is unchanged from before the extraction —
 * its tests moved to `useQuickSortFlow.test.ts`, this file keeps only the
 * rendering-wiring tests.
 */
export function QuickSortScanner({ operatorId, userId, zones, onScanEvent }: QuickSortScannerProps) {
  const {
    state,
    destination,
    currentPackage,
    error,
    counter,
    handlePackageScan,
    handleAndenScan,
  } = useQuickSortFlow({ operatorId, userId, zones, onScanEvent });

  return (
    <div className="flex flex-col gap-3">
      {state === 'scan_package' && (
        <ScanField
          ariaLabel="Escanear paquete"
          onScan={(code) => { void handlePackageScan(code); }}
          helperText="Escanea o escribe el código y presiona Enter"
        />
      )}

      {/* The dock is confirmed by scanning it, not by trusting the suggestion —
          validateDockDestination rejects the wrong one. Both scans stay; only
          the confirm tap between them was removed: the andén field is armed
          the moment the destination is shown. */}
      {state === 'scan_anden' && destination && (
        <>
          <ScanResult
            status="ok"
            title={`ANDÉN ${destination.zone_code} · ${destination.zone_name}`}
            context={currentPackage?.label ?? ''}
            code={destination.zone_code}
          />

          {destination.flagged && (
            <p className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-xs text-status-warning-text">
              Comuna sin andén asignado — redirigiendo a Consolidación
            </p>
          )}

          <ScanField
            size="md"
            ariaLabel="Escanear andén"
            onScan={(code) => { void handleAndenScan(code); }}
            helperText="Escanea el andén para confirmar"
          />
        </>
      )}

      {error && (
        <ScanResult status="error" title={error} context={currentPackage?.label} />
      )}

      <p className="font-mono text-[10.5px] uppercase tracking-[.1em] text-text-muted">
        {counter} paquetes sectorizados en esta sesión
      </p>
    </div>
  );
}
