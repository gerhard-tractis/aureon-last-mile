'use client';

import { useDispatchRetryChecklist } from '@/hooks/dispatch/mobile/useDispatchRetryChecklist';
import { attemptEscalationCopy } from '@/lib/dispatch/mobile/dispatch-attempt-copy';
import type { DispatchErrorInfo } from '@/lib/dispatch/mobile/dispatch-review';

/**
 * spec-77 Fase 3 — `2k`, "DispatchTrack rechazó el envío". Decision 6: the
 * screen names what did NOT change (`info.whatChanged`) before anything
 * else, and its primary action is never a bare "Reintentar" label reused
 * across states — `info.primaryLabel` already encodes Reintentar/
 * Completar/Verificar per `dispatch-review.ts`'s `dispatchErrorCopy`.
 *
 * Shown by `DispatchRouteDispatchReview` in place of the review once a
 * dispatch attempt fails with anything past the pre-flight validation
 * codes (those stay inline on `2j` — nothing to retry there until the crew
 * fixes what's missing).
 */
export interface DispatchRouteErrorProps {
  routeId: string;
  operatorId: string;
  vehicleAssigned: boolean;
  driverAssigned: boolean;
  info: DispatchErrorInfo;
  /** Item 14 — how many dispatch attempts have failed this session
   *  (1-indexed; this is the count INCLUDING the attempt `info` describes). */
  attempt: number;
  onRetry: () => void;
  onBack: () => void;
}

export function DispatchRouteError({
  routeId,
  operatorId,
  vehicleAssigned,
  driverAssigned,
  info,
  attempt,
  onRetry,
  onBack,
}: DispatchRouteErrorProps) {
  // Item 15 — fetched only when the checklist is actually shown (decision
  // 6 scopes it to DT_API_ERROR); `enabled` inside the hook itself already
  // gates on routeId/operatorId, this adds "and only when relevant".
  const { data: checklist } = useDispatchRetryChecklist(
    info.showChecklist ? routeId : null,
    info.showChecklist ? operatorId : null,
    vehicleAssigned,
    driverAssigned,
  );

  const escalation = attemptEscalationCopy(attempt);
  const showPrimary = info.primaryAction !== null && !escalation;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-route-error">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-[19px] font-semibold text-text">No se pudo despachar</h1>
        <p className="text-[13.5px] text-text">{info.text}</p>
      </header>

      {/* item 13 — what did, or did not, change. Always shown, distinct per
          state (never the flattened "no se creó nada" this replaces). */}
      <p
        role="status"
        className="rounded-[10px] border border-status-warning-border bg-status-warning-bg p-3 text-[13px] text-status-warning-text"
      >
        {info.whatChanged}
      </p>

      {info.showChecklist && checklist && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
            Antes de reintentar
          </span>
          <ul className="flex flex-col gap-1 text-[13px] text-text">
            {checklist.verified.map((line) => (
              <li key={line} className="flex items-center gap-2">
                <span aria-hidden="true" className="text-status-success">✓</span>
                {line}
              </li>
            ))}
            {checklist.warnings.map((line) => (
              <li key={line} className="flex items-center gap-2 text-status-warning-text">
                <span aria-hidden="true">⚠</span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {escalation && (
        <p className="rounded-[10px] border border-status-error-border bg-status-error-bg p-3 text-[13px] text-status-error-text">
          {escalation}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {showPrimary && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[56px] w-full rounded-[10px] bg-accent text-[15px] font-semibold text-accent-foreground active:opacity-90"
          >
            {info.primaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] w-full rounded-[10px] border border-border text-[13.5px] font-medium text-text active:opacity-90"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
