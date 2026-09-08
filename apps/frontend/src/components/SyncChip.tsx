'use client';

import { cn } from '@/lib/utils';
import { useSyncQueue } from '@/hooks/useSyncQueue';

/**
 * spec-54 — connection state in the topbar (deferred from phase 2, mock 1e).
 *
 * Replaces ConnectionStatusBanner, a fixed full-width bar that sat over the
 * top of the page and pushed content down whenever the link dropped.
 *
 * The copy follows the handoff's rule: it says what happens to the operator's
 * work, not that the network is down. "SIN CONEXIÓN · 14 EN COLA" tells them
 * their scans are held and counted; the panel beside the count says they can
 * keep working.
 *
 * `operatorId` — spec-81 fase 2: the Recogida side of the count
 * (`pickup_queue`) is now per operator, not device-global (see
 * `useSyncQueue`). Without it, an operator who logs out on a dock phone
 * leaves a stale count the next operator can neither drain nor purge.
 */
export function SyncChip({ operatorId = null }: { operatorId?: string | null }) {
  const { status, queuedCount, blockedCount } = useSyncQueue(operatorId);

  // Online, nothing outstanding, nothing blocked is the normal state and
  // needs no chrome.
  if (status === 'online' && queuedCount === 0 && blockedCount === 0) return null;

  // B3, ronda 2 de review del PR #679 (bloqueante) — un `dead` no puede
  // pintarse en el verde de éxito: es un bloqueo que necesita ayuda, no
  // "todo va bien, está en cola". Mientras haya algo bloqueado, el tono deja
  // de ser success sea cual sea `status`. La afordancia completa (a dónde
  // lleva esto, qué se puede hacer) es fase 4 — este chip sólo deja de
  // mentir.
  const blocked = blockedCount > 0;

  const tone = blocked
    ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
    : status === 'offline'
      ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
      : status === 'syncing'
        ? 'border-border bg-surface-raised text-text-secondary'
        : 'border-status-success-border bg-status-success-bg text-status-success-text';

  const dot = blocked
    ? 'bg-status-warning'
    : status === 'offline'
      ? 'bg-status-warning'
      : status === 'syncing'
        ? 'bg-text-muted'
        : 'bg-status-success';

  const queuedLabel = queuedCount > 0 ? `${queuedCount} EN COLA` : '';
  const blockedLabel = blocked ? `${blockedCount} REQUIERE AYUDA` : '';
  const combinedLabel = [queuedLabel, blockedLabel].filter(Boolean).join(' · ');

  const label =
    status === 'offline'
      ? `SIN CONEXIÓN · ${combinedLabel || `${queuedCount} EN COLA`}`
      : status === 'syncing'
        ? 'SINCRONIZANDO…'
        : combinedLabel;

  return (
    <div
      data-testid="sync-chip"
      role="status"
      aria-live="polite"
      className={cn('flex h-[34px] flex-none items-center gap-1.5 rounded-lg border px-2.5', tone)}
    >
      <span className={cn('h-1.5 w-1.5 flex-none rounded-full', dot)} aria-hidden="true" />
      <span className="font-mono text-[11px] font-medium leading-none">{label}</span>
    </div>
  );
}
