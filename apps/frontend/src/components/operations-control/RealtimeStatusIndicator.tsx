"use client";

import { useState, useEffect } from 'react';

const STALE_THRESHOLD_MS = 30_000;

type VisualState = 'live' | 'stale' | 'offline';

interface RealtimeStatusIndicatorProps {
  status: 'connected' | 'disconnected';
  lastFetchedAt?: Date | null;
}

function deriveVisualState(
  status: 'connected' | 'disconnected',
  lastFetchedAt?: Date | null,
): VisualState {
  if (status === 'disconnected') return 'offline';
  if (
    lastFetchedAt &&
    Date.now() - lastFetchedAt.getTime() > STALE_THRESHOLD_MS
  ) {
    return 'stale';
  }
  return 'live';
}

const STATE_CONFIG: Record<
  VisualState,
  { dotClass: string; label: string }
> = {
  live: {
    dotClass:
      'w-2 h-2 rounded-full bg-[var(--color-status-success)] animate-pulse',
    label: 'En vivo',
  },
  stale: {
    dotClass: 'w-2 h-2 rounded-full bg-[var(--color-status-warning)]',
    label: 'Actualizando...',
  },
  offline: {
    dotClass: 'w-2 h-2 rounded-full bg-[var(--color-status-error)]',
    label: 'Sin conexión',
  },
};

export function RealtimeStatusIndicator({
  status,
  lastFetchedAt,
}: RealtimeStatusIndicatorProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastFetchedAt) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 10_000);
    return () => clearInterval(interval);
  }, [lastFetchedAt]);

  const visualState = deriveVisualState(status, lastFetchedAt);
  const { dotClass, label } = STATE_CONFIG[visualState];

  return (
    <div
      data-testid="realtime-status-indicator"
      className="flex items-center gap-1.5 text-xs text-text-muted"
    >
      <span data-testid="status-dot" className={dotClass} />
      <span>{label}</span>
    </div>
  );
}
