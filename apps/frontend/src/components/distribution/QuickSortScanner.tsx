'use client';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import {
  useQuickSortFlow,
  type QuickSortScanEvent,
  type QuickSortFlowMode,
} from '@/hooks/distribution/useQuickSortFlow';

export type { QuickSortScanEvent };

interface QuickSortScannerProps {
  operatorId: string;
  userId: string;
  zones: DockZone[];
  /** Feeds the "Últimos escaneos" panel alongside this console. */
  onScanEvent?: (event: QuickSortScanEvent) => void;
  /**
   * spec-71 phase 3. 'stage' repoints this same console at the wave-cutoff
   * staging pass — the destination becomes a `load_positions` row instead
   * of a `dock_zones` row. Defaults to 'sectorize' (today's unchanged
   * comuna sort), so every existing caller of this component is unaffected.
   */
  mode?: QuickSortFlowMode;
}

/**
 * spec-68 Fase 5.1 — the desktop presentation of the quicksort scan loop.
 * The state machine itself lives in `useQuickSortFlow` (Fase 5.1): the
 * mobile step-1/step-2 screens (`QuickSortMobile`, `QuickSortMobileDock`)
 * consume the same hook so the two presentations can never drift apart.
 * This component's own behaviour is unchanged from before the extraction —
 * its tests moved to `useQuickSortFlow.test.ts`, this file keeps only the
 * rendering-wiring tests.
 *
 * spec-71 phase 3 adds a third rendered state, `scan_position`, alongside
 * `scan_package`/`scan_anden` — the staging pass's destination scan, wired
 * exactly like the andén one: destination shown and the field armed in the
 * same step, reject state on mismatch instead of a state transition.
 */
export function QuickSortScanner({ operatorId, userId, zones, onScanEvent, mode = 'sectorize' }: QuickSortScannerProps) {
  const {
    state,
    destination,
    positionDestination,
    currentPackage,
    error,
    counter,
    handlePackageScan,
    handleAndenScan,
    handlePositionScan,
  } = useQuickSortFlow({ operatorId, userId, zones, onScanEvent, mode });

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

      {/* spec-71 phase 3 — same shape as scan_anden above, pointed at the
          position the package's route currently occupies. A mismatched scan
          rejects (error + field stays armed) rather than transitioning. */}
      {state === 'scan_position' && positionDestination && (
        <>
          <ScanResult
            status="ok"
            title={`POSICIÓN ${positionDestination.positionCode}${positionDestination.positionLabel ? ` · ${positionDestination.positionLabel}` : ''}`}
            context={currentPackage?.label ?? ''}
            code={positionDestination.positionCode}
          />

          <ScanField
            size="md"
            ariaLabel="Escanear posición"
            onScan={(code) => { void handlePositionScan(code); }}
            helperText="Escanea la posición para confirmar"
          />
        </>
      )}

      {error && (
        <ScanResult status="error" title={error} context={currentPackage?.label} />
      )}

      <p className="font-mono text-[10.5px] uppercase tracking-[.1em] text-text-muted">
        {counter} paquetes {mode === 'stage' ? 'cargados a posición' : 'sectorizados'} en esta sesión
      </p>
    </div>
  );
}
