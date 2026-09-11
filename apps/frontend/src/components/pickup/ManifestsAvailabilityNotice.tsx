'use client';

import { AlertTriangle } from 'lucide-react';
import type { ManifestsAvailability } from '@/lib/pickup/pickupPageHelpers';

/**
 * spec-80 fase 2b (ronda 2) — three DIFFERENT stories that a naive
 * `data ?? []` or a lone `isPending` check would otherwise tell as the
 * same thing ("nothing here"):
 *
 * - `loading` — an ordinary initial fetch, gone in well under a second.
 *   Silent skeleton, no accusation against the network.
 * - `unknown` — genuinely PAUSED with no signal (this repo's
 *   `networkMode: 'online'` default). The one case that actually earns
 *   "revisa tu conexión".
 * - `error` — retries exhausted. A DIFFERENT message with a retry action,
 *   because "check your connection" is the wrong instruction once the SDK
 *   itself already gave up (see M4 in this fase's review: conflating these
 *   two trains the crew to ignore the connection warning).
 * - `known` — renders nothing; the caller shows its real content.
 */
export function ManifestsAvailabilityNotice({
  availability,
  onRetry,
}: {
  availability: ManifestsAvailability;
  onRetry?: () => void;
}) {
  if (availability === 'known') return null;

  if (availability === 'loading') {
    return (
      <div
        role="status"
        aria-busy="true"
        className="h-16 animate-pulse rounded-[10px] border border-border bg-surface-raised"
      />
    );
  }

  if (availability === 'error') {
    return (
      <div
        role="alert"
        className="rounded-[10px] border border-status-error-border bg-status-error-bg px-4 py-4 text-center"
      >
        <p className="text-[13px] font-medium text-status-error-text">No pudimos cargar tus cargas.</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-[44px] w-full rounded-[10px] border border-border bg-surface-raised text-[13.5px] font-medium text-text active:opacity-90"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  // 'unknown'
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-1 rounded-[10px] border border-status-warning-border bg-status-warning-bg px-4 py-5 text-center"
    >
      <AlertTriangle className="h-5 w-5 text-status-warning-text" aria-hidden="true" />
      <p className="text-[13px] font-medium text-status-warning-text">No pudimos comprobar tus cargas</p>
      <p className="text-[12px] text-status-warning-text">
        Revisa tu conexión — puede haber cargas pendientes de firma.
      </p>
    </div>
  );
}
