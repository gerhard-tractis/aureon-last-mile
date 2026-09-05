'use client';

import { useState } from 'react';
import { useDispatchRouteToDT } from '@/hooks/dispatch/mobile/useDispatchRouteToDT';
import { DISPATCH_EFFECTS, NO_VEHICLE_REASON, canDispatch, dispatchErrorCopy, type DispatchErrorInfo } from '@/lib/dispatch/mobile/dispatch-review';
import { formatRouteHeaderDate } from '@/lib/utils/dateFormat';
import { DispatchRouteError } from './DispatchRouteError';

/**
 * spec-77 Fase 2 — `2j`, "Despachar a DispatchTrack". The module's only
 * irreversible action (decision 5): a review, not a bare button. Shown by
 * `DispatchRouteScanSession` once the route is sealed (`loaded`) instead of
 * navigating away, the same "swap state, don't navigate" pattern `2e`/`2h`
 * already use.
 *
 * Every prop here is data the caller already has (from `useRouteLoadBrief`
 * and its own scan session) — this component owns no fetch of its own
 * beyond the dispatch call itself, so it can be tested as pure
 * props-in/callback-out (Lecciones aplicadas — a fixture must only carry
 * data the real hook can actually produce).
 */
export interface DispatchRouteDispatchReviewProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  driverName: string | null;
  vehicleExternalId: string | null;
  routeDate: string | null;
  stopsCount: number;
  packagesCount: number;
  onDispatched: (outcome: { externalRouteId: string; packagesDispatched: number }) => void;
}

export function DispatchRouteDispatchReview({
  routeId,
  operatorId,
  routeCode,
  driverName,
  vehicleExternalId,
  routeDate,
  stopsCount,
  packagesCount,
  onDispatched,
}: DispatchRouteDispatchReviewProps) {
  const { dispatch, isDispatching } = useDispatchRouteToDT();
  // Fase 3 (`2k`) — a failed attempt opens the dedicated error screen
  // (decision 6) instead of an inline paragraph; `attempt` is the
  // client-side counter item 14 asks for (the endpoint exposes none,
  // spec's own Fase 0) and resets only on remount.
  const [error, setError] = useState<DispatchErrorInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Item 12 — a client-side double-tap guard IN ADDITION to
  // `useDispatchRouteToDT`'s own in-flight ref: this is STATE, not a ref,
  // specifically so the button disables (re-renders) before the browser
  // delivers a second click event — a ref alone does not force a
  // re-render between two clicks that land microtasks apart, which is
  // exactly what let a mocked, instantly-resolving hook slip a second
  // call through in this component's own test. Neither guard closes the
  // server-side race between two concurrent devices — see this
  // component's own header and the endpoint's comments (spec-79 review
  // finding 4); that fix is spec-79 Fase 4, not this screen's.
  const [sending, setSending] = useState(false);

  const canSend = canDispatch(vehicleExternalId) && !isDispatching && !sending;

  const handleDispatch = async () => {
    if (!vehicleExternalId || isDispatching || sending) return;
    setSending(true);
    setError(null);
    try {
      const outcome = await dispatch(routeId, {
        truckIdentifier: vehicleExternalId,
        driverIdentifier: driverName,
      });
      if (!outcome.ok) {
        setAttempt((n) => n + 1);
        setError(dispatchErrorCopy(outcome.code, outcome.message));
        return;
      }
      onDispatched({
        externalRouteId: outcome.externalRouteId ?? '',
        packagesDispatched: outcome.packagesDispatched ?? 0,
      });
    } finally {
      setSending(false);
    }
  };

  // Fase 3 (`2k`) — ANY refusal, validation or DT-related, opens the
  // dedicated error screen: decision 6 is about naming what did NOT
  // change, which is true of a pre-flight refusal too (nothing was ever
  // sent). `DispatchRouteError` itself decides whether a primary action
  // makes sense (`info.primaryAction`) — a validation refusal shows only
  // "Volver".
  if (error) {
    return (
      <DispatchRouteError
        routeId={routeId}
        operatorId={operatorId}
        vehicleAssigned={!!vehicleExternalId}
        driverAssigned={!!driverName}
        info={error}
        attempt={attempt}
        onRetry={handleDispatch}
        onBack={() => setError(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-route-dispatch-review">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-[15px] font-bold text-accent">{routeCode}</h1>
        <p className="text-[12.5px] text-text-secondary">Última revisión antes de despachar</p>
      </header>

      <dl className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3.5 text-[13.5px]">
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Camión</dt>
          <dd className="font-mono font-semibold text-text">{vehicleExternalId ?? 'Sin camión asignado'}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Conductor</dt>
          <dd className="font-semibold text-text">{driverName ?? 'Sin conductor'}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Fecha de reparto</dt>
          <dd className="font-semibold text-text">{routeDate ? formatRouteHeaderDate(routeDate) : '—'}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <dt className="text-text-secondary">Paradas · paquetes</dt>
          <dd className="font-semibold text-text">
            {stopsCount} paradas · {packagesCount} paquetes
          </dd>
        </div>
      </dl>

      {/* item 11 — decision 5's four effects, enumerated, never summarized. */}
      <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
          Qué pasa al despachar
        </span>
        <ul className="flex flex-col gap-1.5 text-[13px] text-text">
          {DISPATCH_EFFECTS.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </div>

      {/* item 10 — the reason is real: DispatchTrack requires the vehicle
          identifier, checked here before any request leaves the device. */}
      {!vehicleExternalId && (
        <p className="rounded-[10px] border border-status-warning-border bg-status-warning-bg p-3 text-[13px] text-status-warning-text">
          {NO_VEHICLE_REASON}
        </p>
      )}

      <button
        type="button"
        onClick={handleDispatch}
        disabled={!canSend}
        className="min-h-[56px] w-full rounded-[10px] bg-accent text-[15px] font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 active:opacity-90"
      >
        {isDispatching || sending ? 'Despachando…' : 'Despachar'}
      </button>
    </div>
  );
}
