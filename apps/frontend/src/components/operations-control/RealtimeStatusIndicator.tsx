"use client";

import { useState, useEffect } from 'react';

interface RealtimeStatusIndicatorProps {
  status: 'connected' | 'disconnected';
  lastFetchedAt?: Date | null;
}

function getTimeAgoText(fetchedAt: Date): string {
  const diffSeconds = Math.floor((Date.now() - fetchedAt.getTime()) / 1000);
  if (diffSeconds < 60) {
    return `Actualizado hace ${diffSeconds}s`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  return `Actualizado hace ${diffMinutes}m`;
}

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

  const isConnected = status === 'connected';

  return (
    <div
      data-testid="realtime-status-indicator"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        data-testid="status-dot"
        className={
          isConnected
            ? 'w-2 h-2 rounded-full bg-green-500 animate-pulse'
            : 'w-2 h-2 rounded-full bg-red-500'
        }
      />
      <span>{isConnected ? 'En vivo' : 'Offline'}</span>
      {lastFetchedAt && (
        <>
          <span className="text-muted-foreground/60">·</span>
          <span>{getTimeAgoText(lastFetchedAt)}</span>
        </>
      )}
    </div>
  );
}
