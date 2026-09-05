'use client';

import { useState } from 'react';
import { DispatchRouteDispatchReview } from './DispatchRouteDispatchReview';
import { DispatchRouteAcceptance } from './DispatchRouteAcceptance';

/**
 * spec-77 Fase 2/Fase 4 — `2j` then `2l`, as one state machine: extracted
 * out of `DispatchRouteScanSession` (which was about to cross the 300-line
 * cap) purely to keep that file's own scan-loop concerns separate from the
 * handoff's. Owns nothing about scanning/sealing — `sealedOutcome` (item 16's
 * released/split figures) arrives already decided by the close step.
 */
export interface DispatchRouteHandoffProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  driverName: string | null;
  vehicleExternalId: string | null;
  routeDate: string | null;
  stopsCount: number;
  packagesCount: number;
  packagesLeftAtDock: number;
  splitOrdersCount: number;
  onBack: () => void;
  onOpenNextLoad: (routeId: string) => void;
}

export function DispatchRouteHandoff({
  routeId,
  operatorId,
  routeCode,
  driverName,
  vehicleExternalId,
  routeDate,
  stopsCount,
  packagesCount,
  packagesLeftAtDock,
  splitOrdersCount,
  onBack,
  onOpenNextLoad,
}: DispatchRouteHandoffProps) {
  // spec-77 Fase 4 — set once `POST /dispatch` itself returns `ok: true`
  // (item 18: this trusts the endpoint's own response, it does not
  // re-assert route/package state — that is spec-79's own test suite's job).
  const [dispatchOutcome, setDispatchOutcome] = useState<{ externalRouteId: string; packagesDispatched: number } | null>(
    null,
  );

  if (dispatchOutcome) {
    return (
      <DispatchRouteAcceptance
        routeId={routeId}
        operatorId={operatorId}
        routeCode={routeCode}
        externalRouteId={dispatchOutcome.externalRouteId}
        stopsCount={stopsCount}
        packagesDispatched={dispatchOutcome.packagesDispatched}
        packagesLeftAtDock={packagesLeftAtDock}
        splitOrdersCount={splitOrdersCount}
        onBack={onBack}
        onOpenNextLoad={onOpenNextLoad}
      />
    );
  }

  return (
    <DispatchRouteDispatchReview
      routeId={routeId}
      operatorId={operatorId}
      routeCode={routeCode}
      driverName={driverName}
      vehicleExternalId={vehicleExternalId}
      routeDate={routeDate}
      stopsCount={stopsCount}
      packagesCount={packagesCount}
      onDispatched={setDispatchOutcome}
    />
  );
}
