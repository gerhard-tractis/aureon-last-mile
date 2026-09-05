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
import { DispatchRouteCameraViewfinder } from './DispatchRouteCameraViewfinder';
import { DispatchRouteCloseSheet, type DispatchRouteSealedOutcome } from './DispatchRouteCloseSheet';
import { DispatchRouteHandoff } from './DispatchRouteHandoff';
import { useSealRoute } from '@/hooks/dispatch/mobile/useSealRoute';
import { closeButtonLabel, missingOrders } from '@/lib/dispatch/mobile/route-close';
import { sealErrorCopy } from '@/lib/dispatch/mobile/seal-error-copy';

// spec-76 decision 4 — verbatim in spirit: the camera is a fallback, not an
// equivalent input. Named here, not buried in a tooltip, because a
// touchscreen has no hover state to reveal a title= attribute.
const CAMERA_THROUGHPUT_COPY =
  'La cámara lee de una en una. Con el lector Zebra el ritmo es de tres a cuatro veces mayor: úsala sólo si el handheld no está disponible.';

export interface DispatchRouteScanSessionProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  loadPositionLabel: string | null;
  driverName: string | null;
  vehicleExternalId: string | null;
  /** spec-77 Fase 2 — `2j`'s "fecha de reparto"; sourced from
   *  `useRouteLoadBrief` (the same read this whole crew tree already
   *  shares), not a second fetch. */
  routeDate: string | null;
  /** spec-77 Fase 2 — `2j`'s "paradas" figure; same source as above. */
  stopsCount: number;
  /** spec-76 task 4 — 2h now exists: "Ver los N" hands control to the
   *  caller (DispatchRouteSurface) instead of navigating, mirroring how
   *  "Empezar a escanear" already swaps this same page's own state rather
   *  than pushing a new route. */
  onViewPackages: () => void;
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
  routeDate,
  stopsCount,
  onViewPackages,
}: DispatchRouteScanSessionProps) {
  const router = useRouter();
  // Starts false, deliberately — same rationale as ReceptionMobileSession
  // (spec-62 finding 1): ScanField's mount effect only fires
  // onFocusStateChange once focus genuinely lands, so a hardcoded `true`
  // here would claim the field is armed before that has actually happened.
  const [readerArmed, setReaderArmed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  // spec-76 task 4 (2g) — which input owns the field right now. Starts on
  // the reader: the mock and decision 4 both treat the camera as the
  // fallback, never the default.
  const [inputMode, setInputMode] = useState<'reader' | 'camera'>('reader');
  // spec-77 Fase 1 (UI) — 2i. Only opened when Cerrar ruta finds something
  // still missing (item 3): a route with nothing outstanding seals directly
  // below, no sheet at all.
  const [closeSheetOpen, setCloseSheetOpen] = useState(false);
  // spec-77 Fase 2 — `2j`. Set once sealing succeeds (direct OR forced);
  // this screen then swaps its own render to the dispatch review instead
  // of navigating away — same pattern as `scanning`/`viewingPackages` in
  // DispatchRouteSurface.
  const [dispatchReviewOpen, setDispatchReviewOpen] = useState(false);
  // B2 (adversarial review) — the direct-close path used to await `seal`
  // and discard any `!outcome.ok` result outright: no `else`, so a `409
  // UNSEALED_STOPS`/`422 EMPTY_ROUTE`/`409 ROUTE_NOT_OPEN`/`500`, or
  // `useSealRoute`'s own offline message, all resolved to a dead button on
  // dock wifi. Surfaced here, cleared on every new attempt.
  const [closeError, setCloseError] = useState<string | null>(null);
  // spec-77 Fase 4 (`2l`) — what the seal/force outcome actually released
  // or split, carried from the close step through to the acta (item 16).
  // Zero on a direct close: nothing was released.
  const [sealedOutcome, setSealedOutcome] = useState<{ packagesLeftAtDock: number; splitOrdersCount: number }>({
    packagesLeftAtDock: 0,
    splitOrdersCount: 0,
  });

  const {
    submitScan,
    lastEntry,
    history,
    rejectionCount,
    rejectionTally,
    packagesLoaded,
    packagesTotal,
    percent,
    packages,
  } = useRouteScanSession(routeId, operatorId);
  const { seal, isSealing } = useSealRoute();

  // B3 (adversarial review) — derived from `packages`' own `dispatches.stage`
  // (via `missingOrders`, `route-close.ts`), the same fact the server's
  // pending definition (`route_stop_counts.pending_stops +
  // partially_staged_stops`) is built from — never `packagesTotal -
  // packagesLoaded`, which counts a narrower package-status set than
  // `recompute_dispatch_stage` does and drifts from the server in both
  // directions (see `route-close.ts`'s header for the two concrete cases).
  const missing = missingOrders(packages);
  const missingBoxCount = missing.reduce((sum, m) => sum + m.missingCount, 0);

  // item 3 — nothing missing closes directly, no confirmation. A
  // successful seal (direct here, or forced via the sheet below) opens
  // `2j` in place rather than navigating anywhere.
  const handleCloseRoute = async () => {
    if (missing.length > 0) {
      setCloseSheetOpen(true);
      return;
    }
    setCloseError(null);
    const outcome = await seal(routeId);
    if (outcome.ok) {
      // Direct close: nothing was ever short, so nothing was released.
      setSealedOutcome({ packagesLeftAtDock: 0, splitOrdersCount: 0 });
      setDispatchReviewOpen(true);
      return;
    }
    setCloseError(sealErrorCopy(outcome.code, outcome.message).text);
  };

  if (dispatchReviewOpen) {
    return (
      <DispatchRouteHandoff
        routeId={routeId}
        operatorId={operatorId}
        routeCode={routeCode}
        driverName={driverName}
        vehicleExternalId={vehicleExternalId}
        routeDate={routeDate}
        stopsCount={stopsCount}
        packagesCount={packagesLoaded}
        packagesLeftAtDock={sealedOutcome.packagesLeftAtDock}
        splitOrdersCount={sealedOutcome.splitOrdersCount}
        onBack={() => router.push('/app/dispatch')}
        onOpenNextLoad={(nextRouteId) => router.push(`/app/dispatch/${nextRouteId}`)}
      />
    );
  }

  const metaLine = [loadPositionLabel, driverName ?? 'Sin conductor', vehicleExternalId]
    .filter((v): v is string => !!v)
    .join(' · ');

  return (
    <div className="flex flex-col" data-testid="dispatch-route-scan-session">
      {/* spec-76 review "spec deviations" — decision 4 requires the result,
          counter and armed field to stay visible for the whole hour the
          crew watches this screen; a plain scrolling column let them scroll
          away after ~10 reads. `sticky` (not a separate flex region) keeps
          this working without restructuring whatever scroll container the
          page shell above this component provides. */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-surface p-4 pb-3">
        <header className="flex flex-col gap-1">
          <h1 className="font-mono text-[15px] font-bold text-accent">{routeCode}</h1>
          {metaLine && <p className="text-[12.5px] text-text-secondary">{metaLine}</p>}
          {inputMode === 'reader' ? (
            <DispatchScanReaderStatus armed={readerArmed} />
          ) : (
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[.06em] text-text-secondary">
              MODO CÁMARA
            </p>
          )}
        </header>

        <div className="flex items-baseline gap-2" data-testid="dispatch-scan-counter">
          <span className="font-heading text-[28px] font-semibold leading-none text-text">
            {packagesLoaded} de {packagesTotal} paquetes
          </span>
          {/* U+2009 THIN SPACE before "%" — spec copy is "86 %", not "86%". */}
          <span className="text-[15px] font-medium text-text-secondary">· {percent}&#8201;%</span>
        </div>

        <div className="flex flex-col gap-2">
          {inputMode === 'reader' ? (
            /* Deliberately NOT `disabled={isSubmitting}` — unlike
               ReceptionMobileSession (spec-62), which gates its field on its
               own pending scan. Design intent here is explicit: "no per-package
               confirmation" (spec, Goal). Blocking the field until a network
               round-trip resolves would BE a confirmation gate, and is exactly
               what the mock's "ritmo tres a cuatro veces mayor" throughput is
               measured against. `useRouteScanSession` still applies every
               result via functional setState ordered by atIso, so out-of-order
               responses can't lose or misplace a history entry even when two
               scans overlap in flight — and a repeat of a code still in
               flight (a double Zebra trigger-pull) is deduped before it ever
               reaches the network. */
            <ScanField ariaLabel="Escanear paquete" onScan={submitScan} onFocusStateChange={setReaderArmed} />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-[1.4] text-text-secondary">{CAMERA_THROUGHPUT_COPY}</p>
              <DispatchRouteCameraViewfinder active={inputMode === 'camera'} onDecode={submitScan} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="min-h-[44px] self-start text-[12.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4"
          >
            Ingresar código
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 pt-1">
        {lastEntry && (
          <DispatchScanLastRead entry={lastEntry} onViewRoute={(id) => router.push(`/app/dispatch/${id}`)} />
        )}

        <DispatchScanRejectionSummary rejectionCount={rejectionCount} tally={rejectionTally} />

        <DispatchScanHistoryList entries={history} />
      </div>

      <footer className="mt-2 flex flex-col gap-2 p-4 pt-0">
        {closeError && (
          <p
            role="alert"
            className="rounded-[10px] border border-status-error-border bg-status-error-bg px-3 py-2 text-[12.5px] text-status-error-text"
          >
            {closeError}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setInputMode(inputMode === 'reader' ? 'camera' : 'reader')}
            className="flex min-h-[48px] flex-1 items-center justify-center rounded-[10px] border border-border px-2 text-center text-[13px] font-medium text-text active:opacity-90"
          >
            {inputMode === 'reader' ? 'Cámara' : 'Volver al lector'}
          </button>
          <button
            type="button"
            onClick={onViewPackages}
            className="flex min-h-[48px] flex-1 items-center justify-center rounded-[10px] border border-border px-2 text-center text-[13px] font-medium text-text active:opacity-90"
          >
            Ver los {packagesLoaded}
          </button>
        </div>
        <button
          type="button"
          onClick={handleCloseRoute}
          disabled={isSealing}
          className="flex min-h-[56px] w-full items-center justify-center rounded-[10px] bg-surface-raised text-[15px] font-semibold text-text disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSealing ? 'Cerrando…' : closeButtonLabel(missingBoxCount)}
        </button>
      </footer>

      <DispatchManualCodeSheet open={manualOpen} onOpenChange={setManualOpen} onSubmit={submitScan} />
      <DispatchRouteCloseSheet
        open={closeSheetOpen}
        onOpenChange={setCloseSheetOpen}
        routeId={routeId}
        routeCode={routeCode}
        loadPositionLabel={loadPositionLabel}
        packagesLoaded={packagesLoaded}
        packages={packages}
        onSealed={(outcome: DispatchRouteSealedOutcome) => {
          setSealedOutcome({
            packagesLeftAtDock: outcome.packagesLeftAtDock,
            splitOrdersCount: outcome.splitOrdersCount,
          });
          setDispatchReviewOpen(true);
        }}
      />
    </div>
  );
}
