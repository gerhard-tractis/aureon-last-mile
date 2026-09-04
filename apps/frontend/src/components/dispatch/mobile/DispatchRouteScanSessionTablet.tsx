'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanField } from '@/components/scan/ScanField';
import { useRouteScanSession } from '@/hooks/dispatch/mobile/useRouteScanSession';
import { DispatchScanReaderStatus } from './DispatchScanReaderStatus';
import { DispatchScanLastRead } from './DispatchScanLastRead';
import { DispatchManualCodeSheet } from './DispatchManualCodeSheet';
import { DispatchRouteCameraViewfinder } from './DispatchRouteCameraViewfinder';
import { DispatchTabletSidePanel } from './DispatchTabletSidePanel';
import { DispatchTabletActionBar } from './DispatchTabletActionBar';
import type { IncompleteOrder, OrderBoxCount, ComunaCount } from '@/lib/dispatch/mobile/route-load-brief';

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
  routeStatus: string | undefined;
  onViewPackages: () => void;
}

/**
 * spec-78 `3a` — the dock tablet, 1024 × 768. A LAYOUT VARIANT of the same
 * session tree `DispatchRouteScanSession` (`2e`) renders on a phone, per
 * decision 1: "una variante de layout del árbol de sesión, reusando sus
 * componentes, no un tercer conjunto de componentes." It calls
 * `useRouteScanSession` itself (the same hook 2e calls) rather than
 * receiving its state as props — the two never mount at once (viewport
 * decides between them in `DispatchRouteSurface`), so this is not two
 * copies of the state, just two renderers of the same hook contract.
 *
 * Decision 2 (legibility at 3m) is why the counter and last-read text
 * sizes below are visibly larger than 2e's — verified by eye in QA per
 * the spec's own fase 4, not something a unit test can prove.
 *
 * Decision 5 (no page scroll): this component fixes a full-height grid
 * (`h-screen` two columns); only the side panel's own internal region
 * scrolls (`DispatchTabletSidePanel`). Últimas lecturas / órdenes
 * incompletas are the long lists that would otherwise force a page
 * scroll.
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
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

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

  const comunaLabel =
    comunas.length === 1 ? comunas[0].comuna : comunas.length > 1 ? `${comunas.length} comunas` : null;

  const canDispatch = routeStatus === 'loaded' && !!vehicleExternalId;
  const dispatchDisabledReason = routeStatus !== 'loaded' ? DISPATCH_NOT_READY_REASON : !vehicleExternalId ? NO_VEHICLE_REASON : null;

  // Same endpoint desktop's RouteBuilder/RoutePanel already call for a
  // `loaded` route (decision: "despachar lo puede hacer cualquiera de las
  // tres superficies") — the assignment made in 2d is the source of
  // truck/driver here, not a dropdown, since this screen never lets the
  // crew pick a different vehicle mid-scan.
  async function handleDispatch() {
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truck_identifier: vehicleExternalId, driver_identifier: driverName || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Error al despachar');
      router.push('/app/dispatch');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setDispatchError(e.message ?? 'Error de DispatchTrack');
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden" data-testid="dispatch-route-scan-session-tablet">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border bg-surface px-5 py-3">
        <h1 className="font-mono text-[17px] font-bold text-accent">{routeCode}</h1>
        {loadPositionLabel && <span className="text-[13px] text-text-secondary">{loadPositionLabel}</span>}
        {comunaLabel && <span className="text-[13px] text-text-secondary">{comunaLabel}</span>}
        <span className="text-[13px] text-text-secondary">{driverName ?? 'Sin conductor'}</span>
        <div className="ml-auto">
          {inputMode === 'reader' ? (
            <DispatchScanReaderStatus armed={readerArmed} />
          ) : (
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[.06em] text-text-secondary">
              MODO CÁMARA
            </p>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
          <div className="flex items-baseline gap-3" data-testid="dispatch-scan-counter">
            <span className="font-heading text-[48px] font-semibold leading-none text-text">
              {packagesLoaded} de {packagesTotal}
            </span>
            <span className="text-[20px] font-medium text-text-secondary">· {percent}&#8201;%</span>
          </div>

          {lastEntry ? (
            <DispatchScanLastRead entry={lastEntry} onViewRoute={(id) => router.push(`/app/dispatch/${id}`)} />
          ) : (
            <p className="text-[13px] text-text-secondary">Las lecturas de esta sesión aparecen aquí.</p>
          )}

          <div className="mt-auto flex flex-col gap-2">
            {inputMode === 'reader' ? (
              <>
                <ScanField
                  ariaLabel="Escanear paquete"
                  size="lg"
                  helperText={SCAN_HINT}
                  onScan={submitScan}
                  onFocusStateChange={setReaderArmed}
                />
              </>
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

      <DispatchManualCodeSheet open={manualOpen} onOpenChange={setManualOpen} onSubmit={submitScan} />
    </div>
  );
}
