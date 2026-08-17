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
 */
export function SyncChip() {
  const { status, queuedCount } = useSyncQueue();

  // Online and nothing outstanding is the normal state and needs no chrome.
  if (status === 'online' && queuedCount === 0) return null;

  const tone =
    status === 'offline'
      ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
      : status === 'syncing'
        ? 'border-border bg-surface-raised text-text-secondary'
        : 'border-status-success-border bg-status-success-bg text-status-success-text';

  const dot =
    status === 'offline'
      ? 'bg-status-warning'
      : status === 'syncing'
        ? 'bg-text-muted'
        : 'bg-status-success';

  const label =
    status === 'offline'
      ? `SIN CONEXIÓN · ${queuedCount} EN COLA`
      : status === 'syncing'
        ? 'SINCRONIZANDO…'
        : `${queuedCount} EN COLA`;

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
