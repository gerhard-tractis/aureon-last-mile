'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanField } from '@/components/scan/ScanField';
import { useRouteScanSession } from '@/hooks/dispatch/mobile/useRouteScanSession';
import { DispatchScanReaderStatus } from './DispatchScanReaderStatus';
import { DispatchScanLastRead } from './DispatchScanLastRead';
import { DispatchScanHistoryList } from './DispatchScanHistoryList';
import { DispatchScanRejectionSummary } from './DispatchScanRejectionSummary';
import { DispatchManualCodeSheet } from './DispatchManualCodeSheet';

// None of 2g (camera fallback), 2h (packages-by-stop) or 2i (close route,
// spec-77) exist on this branch yet. Same convention DispatchRouteSurface
// already used for the scan CTA before this task: a disabled button with
// its reason named, never a live-looking one that silently does nothing on
// a loading bay.
const CAMERA_DISABLED_REASON = 'La lectura por cámara llega en la próxima pantalla (2g)';
const PACKAGE_LIST_DISABLED_REASON = 'La lista de paquetes por parada llega en la próxima pantalla (2h)';
const CLOSE_ROUTE_DISABLED_REASON = 'El cierre de ruta es la próxima pantalla — spec-77';

export interface DispatchRouteScanSessionProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  loadPositionLabel: string | null;
  driverName: string | null;
  vehicleExternalId: string | null;
}

/**
 * spec-76 2e/2f — the continuous scan loop. Design intent (spec's own
 * words): "no per-package confirmation" — result big at the top, history
 * below, counter always visible. 2f is not a separate component: a
 * rejected read is a STATE of this same screen (decision 5), rendered by
 * `DispatchScanLastRead` from the same `lastEntry` an accepted read uses —
 * colour and icon change, the field stays armed, nothing here ever blocks
 * on it.
 */
export function DispatchRouteScanSession({
  routeId,
  operatorId,
  routeCode,
  loadPositionLabel,
  driverName,
  vehicleExternalId,
}: DispatchRouteScanSessionProps) {
  const router = useRouter();
  // Starts false, deliberately — same rationale as ReceptionMobileSession
  // (spec-62 finding 1): ScanField's mount effect only fires
  // onFocusStateChange once focus genuinely lands, so a hardcoded `true`
  // here would claim the field is armed before that has actually happened.
  const [readerArmed, setReaderArmed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const {
    submitScan,
    lastEntry,
    history,
    rejectionCount,
    rejectionTally,
    packagesLoaded,
    packagesTotal,
    percent,
  } = useRouteScanSession(routeId, operatorId);

  const metaLine = [loadPositionLabel, driverName ?? 'Sin conductor', vehicleExternalId]
    .filter((v): v is string => !!v)
    .join(' · ');

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-route-scan-session">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-[15px] font-bold text-accent">{routeCode}</h1>
        {metaLine && <p className="text-[12.5px] text-text-secondary">{metaLine}</p>}
        <DispatchScanReaderStatus armed={readerArmed} />
      </header>

      <div className="flex items-baseline gap-2" data-testid="dispatch-scan-counter">
        <span className="font-heading text-[28px] font-semibold leading-none text-text">
          {packagesLoaded} de {packagesTotal} paquetes
        </span>
        <span className="text-[15px] font-medium text-text-secondary">{percent}%</span>
      </div>

      <div className="flex flex-col gap-2">
        {/* Deliberately NOT `disabled={isSubmitting}` — unlike
            ReceptionMobileSession (spec-62), which gates its field on its
            own pending scan. Design intent here is explicit: "no per-package
            confirmation" (spec, Goal). Blocking the field until a network
            round-trip resolves would BE a confirmation gate, and is exactly
            what the mock's "ritmo tres a cuatro veces mayor" throughput is
            measured against. `useRouteScanSession` still applies every
            result via functional setState, so out-of-order responses can't
            lose a history entry even when two scans overlap in flight. */}
        <ScanField ariaLabel="Escanear paquete" onScan={submitScan} onFocusStateChange={setReaderArmed} />
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="min-h-[44px] self-start text-[12.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4"
        >
          Ingresar código
        </button>
      </div>

      {lastEntry && (
        <DispatchScanLastRead entry={lastEntry} onViewRoute={(id) => router.push(`/app/dispatch/${id}`)} />
      )}

      <DispatchScanRejectionSummary rejectionCount={rejectionCount} tally={rejectionTally} />

      <DispatchScanHistoryList entries={history} />

      <footer className="mt-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title={CAMERA_DISABLED_REASON}
            className="flex min-h-[48px] flex-1 items-center justify-center rounded-[10px] border border-border text-[13px] font-medium text-text-muted disabled:cursor-not-allowed"
          >
            Cámara
          </button>
          <button
            type="button"
            disabled
            title={PACKAGE_LIST_DISABLED_REASON}
            className="flex min-h-[48px] flex-1 items-center justify-center rounded-[10px] border border-border text-[13px] font-medium text-text-muted disabled:cursor-not-allowed"
          >
            Ver los {packagesLoaded}
          </button>
        </div>
        <button
          type="button"
          disabled
          title={CLOSE_ROUTE_DISABLED_REASON}
          className="flex min-h-[56px] w-full items-center justify-center rounded-[10px] bg-surface-raised text-[15px] font-semibold text-text-muted disabled:cursor-not-allowed"
        >
          Cerrar ruta
        </button>
        <p className="text-center text-[11.5px] text-text-muted">{CLOSE_ROUTE_DISABLED_REASON}</p>
      </footer>

      <DispatchManualCodeSheet open={manualOpen} onOpenChange={setManualOpen} onSubmit={submitScan} />
    </div>
  );
}
