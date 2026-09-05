'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanField } from '@/components/scan/ScanField';
import { useRouteScanSession } from '@/hooks/dispatch/mobile/useRouteScanSession';
import { useDispatchRouteToDispatchTrack } from '@/hooks/dispatch/useDispatchRouteToDispatchTrack';
import { DispatchScanReaderStatus } from './DispatchScanReaderStatus';
import { DispatchScanLastRead } from './DispatchScanLastRead';
import { DispatchTabletRate } from './DispatchTabletRate';
import { DispatchManualCodeSheet } from './DispatchManualCodeSheet';
import { DispatchRouteCameraViewfinder } from './DispatchRouteCameraViewfinder';
import { DispatchTabletSidePanel } from './DispatchTabletSidePanel';
import { DispatchTabletActionBar } from './DispatchTabletActionBar';
import { refocusPackageField } from '@/lib/scan/refocus-package-field';
import type { IncompleteOrder, OrderBoxCount, ComunaCount } from '@/lib/dispatch/mobile/route-load-brief';
import type { RouteStatus } from '@/lib/dispatch/types';

const CAMERA_THROUGHPUT_COPY =
  'La cámara lee de una en una. Con el lector Zebra el ritmo es de tres a cuatro veces mayor: úsala sólo si el handheld no está disponible.';
const SCAN_HINT = 'Pasa el siguiente paquete · el campo se limpia solo';
const DISPATCH_NOT_READY_REASON = 'Disponible cuando la ruta esté cerrada';
const NO_VEHICLE_REASON = 'Requiere un vehículo asignado';

export interface DispatchRouteScanSessionTabletProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  loadPositionLabel: string | null;
  driverName: string | null;
  vehicleExternalId: string | null;
  vehicleCapacityPackages: number | null;
  ordersCount: number;
  stopsCount: number;
  pendingOnDock: number;
  incompleteOrders: IncompleteOrder[];
  orderBoxCounts: ReadonlyMap<string, OrderBoxCount>;
  comunas: ComunaCount[];
  /** Real route status (`useDispatchRoute`), only ever fetched for this
   *  branch — see DispatchRouteSurface.tsx. Drives whether "Despachar a
   *  DispatchTrack" is actually clickable (its real precondition), never
   *  guessed at from client-local scan state. */
  routeStatus: RouteStatus | undefined;
  onViewPackages: () => void;
}

/**
 * spec-78 `3a` — the dock tablet. A LAYOUT VARIANT of the same session
 * tree `DispatchRouteScanSession` (`2e`) renders on a phone, per decision
 * 1: "una variante de layout del árbol de sesión, reusando sus
 * componentes, no un tercer conjunto de componentes." It calls
 * `useRouteScanSession` itself (the same hook 2e calls) rather than
 * receiving its state as props — the two never mount at once (viewport
 * decides between them in `DispatchRouteSurface`), so this is not two
 * copies of the state, just two renderers of the same hook contract.
 *
 * Decision 2 (legibility at 3m) — the reviewer's ruling: the mock's own
 * 14px for `86 %` is not distance-checked and loses to the decision's own
 * requirement, so `DispatchScanLastRead`/`DispatchScanReaderStatus` are
 * rendered at `size="lg"` here (their pre-existing sizing, `"md"`, is
 * exactly 2e's, unchanged) on top of this component's own larger counter.
 * Verified by eye in QA per the spec's own fase 4 physical check, not
 * something a unit test can prove.
 *
 * Decision 5 (no page scroll) — spec-78 review C1: the real available
 * height under `AppLayout`'s 56px `TopBar` is `100dvh - 3.5rem`, not
 * `100vh`/`h-screen` (both siblings, `RouteBuilder.tsx`/
 * `RouteTrackingView.tsx`, corrected to the same value in this review).
 * Only the side panel's own internal region scrolls
 * (`DispatchTabletSidePanel`) and, per review I4, the last-read region
 * absorbs any overflow of its own (`min-h-0 overflow-y-auto`) so a long
 * rejection banner cannot push the scan field itself out of the clipped
 * area — the one control the crew actually needs stays structurally
 * pinned at the bottom regardless of what the last read renders.
 */
export function DispatchRouteScanSessionTablet({
  routeId,
  operatorId,
  routeCode,
  loadPositionLabel,
  driverName,
  vehicleExternalId,
  vehicleCapacityPackages,
  ordersCount,
  stopsCount,
  pendingOnDock,
  incompleteOrders,
  orderBoxCounts,
  comunas,
  routeStatus,
  onViewPackages,
}: DispatchRouteScanSessionTabletProps) {
  const router = useRouter();
  const [readerArmed, setReaderArmed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [inputMode, setInputMode] = useState<'reader' | 'camera'>('reader');

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

  // spec-78 review I1 — the request itself is shared with desktop's
  // RouteBuilder via this hook; this component owns only its own
  // confirmation UI and post-success navigation. spec-79 M-2 (round 8
  // mediums) — `errorInfo` is the mapped `dispatchErrorCopy` result, not a
  // raw string; see the hook's own header.
  const { dispatch: dispatchToDispatchTrack, dispatching, errorInfo: dispatchError } = useDispatchRouteToDispatchTrack(routeId);

  const comunaLabel =
    comunas.length === 1 ? comunas[0].comuna : comunas.length > 1 ? `${comunas.length} comunas` : null;

  const canDispatch = routeStatus === 'loaded' && !!vehicleExternalId;
  let dispatchDisabledReason: string | null = null;
  if (routeStatus !== 'loaded') {
    dispatchDisabledReason = DISPATCH_NOT_READY_REASON;
  } else if (!vehicleExternalId) {
    dispatchDisabledReason = NO_VEHICLE_REASON;
  }

  // spec-78 review I3 — stable identity so the memo'd DispatchTabletActionBar
  // does not re-render on every unrelated scan.
  const handleDispatch = useCallback(async () => {
    const ok = await dispatchToDispatchTrack({
      truckIdentifier: vehicleExternalId ?? '',
      driverIdentifier: driverName || null,
    });
    if (ok) router.push('/app/dispatch');
  }, [dispatchToDispatchTrack, vehicleExternalId, driverName, router]);

  // spec-78 review — the oldest ACCEPTED entry in this session's own
  // history (newest-first) is this session's "first scan" for the ritmo
  // derivation; a rejection never started the clock.
  const acceptedEntries = history.filter((e) => e.kind === 'accepted');
  const firstScanAtIso = acceptedEntries.length ? acceptedEntries[acceptedEntries.length - 1].atIso : null;

  return (
    <div
      className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden"
      data-testid="dispatch-route-scan-session-tablet"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border bg-surface px-5 py-3">
        <h1 className="font-mono text-[17px] font-bold text-accent">{routeCode}</h1>
        {loadPositionLabel && <span className="text-[13px] text-text-secondary">{loadPositionLabel}</span>}
        {comunaLabel && <span className="text-[13px] text-text-secondary">{comunaLabel}</span>}
        <div className="ml-auto">
          {inputMode === 'reader' ? (
            <DispatchScanReaderStatus armed={readerArmed} size="lg" />
          ) : (
            <p className="font-mono text-[15px] font-semibold uppercase tracking-[.06em] text-text-secondary">
              MODO CÁMARA
            </p>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
          <div className="flex shrink-0 items-baseline gap-3" data-testid="dispatch-scan-counter">
            <span className="font-heading text-[48px] font-semibold leading-none text-text">
              {packagesLoaded} de {packagesTotal}
            </span>
            {/* U+2009 THIN SPACE before "%" — spec copy is "86 %", not "86%". */}
            <span className="text-[20px] font-medium text-text-secondary">· {percent}&#8201;%</span>
            <DispatchTabletRate packagesLoaded={packagesLoaded} firstScanAtIso={firstScanAtIso} />
          </div>

          {/* spec-78 review I4 — this region owns the overflow, not the
              column: a long ALREADY_IN_ROUTE rejection banner (or a "Ver
              ruta" button) scrolls WITHIN this box instead of pushing the
              scan field below it past the column's own clip. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {lastEntry ? (
              <DispatchScanLastRead entry={lastEntry} onViewRoute={(id) => router.push(`/app/dispatch/${id}`)} size="lg" />
            ) : (
              <p className="text-[13px] text-text-secondary">Las lecturas de esta sesión aparecen aquí.</p>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            {inputMode === 'reader' ? (
              <ScanField
                ariaLabel="Escanear paquete"
                size="lg"
                helperText={SCAN_HINT}
                onScan={submitScan}
                onFocusStateChange={setReaderArmed}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] leading-[1.4] text-text-secondary">{CAMERA_THROUGHPUT_COPY}</p>
                <DispatchRouteCameraViewfinder active={inputMode === 'camera'} onDecode={submitScan} />
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="min-h-[44px] text-[12.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4"
              >
                Ingresar código
              </button>
              <button
                type="button"
                onClick={() => setInputMode(inputMode === 'reader' ? 'camera' : 'reader')}
                className="min-h-[44px] text-[12.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4"
              >
                {inputMode === 'reader' ? 'Usar cámara' : 'Volver al lector'}
              </button>
              <button
                type="button"
                onClick={onViewPackages}
                className="min-h-[44px] text-[12.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4"
              >
                Ver los {packagesLoaded}
              </button>
            </div>
          </div>
        </div>

        <DispatchTabletSidePanel
          vehicleExternalId={vehicleExternalId}
          driverName={driverName}
          packagesLoaded={packagesLoaded}
          vehicleCapacityPackages={vehicleCapacityPackages}
          ordersCount={ordersCount}
          stopsCount={stopsCount}
          pendingOnDock={pendingOnDock}
          rejectionCount={rejectionCount}
          rejectionTally={rejectionTally}
          history={history}
          incompleteOrders={incompleteOrders}
          orderBoxCounts={orderBoxCounts}
        />
      </div>

      <DispatchTabletActionBar
        packagesLoaded={packagesLoaded}
        canDispatch={canDispatch}
        dispatchDisabledReason={dispatchDisabledReason}
        dispatching={dispatching}
        dispatchError={dispatchError}
        onDispatch={handleDispatch}
      />

      <DispatchManualCodeSheet
        open={manualOpen}
        onOpenChange={(open) => {
          setManualOpen(open);
          // spec-78 review I2 — DispatchManualCodeSheet's own header
          // documents this as a deliberate NO-OP for 2e (a phone in the
          // crew's hand: Radix returns focus to the trigger, which is
          // visible and re-tappable). A tablet mounted on a post is the
          // device nobody wants to touch mid-shift — refocus here, at
          // this call site only, rather than changing that shared
          // component's documented behaviour for 2e too.
          if (!open) refocusPackageField();
        }}
        onSubmit={submitScan}
      />
    </div>
  );
}
