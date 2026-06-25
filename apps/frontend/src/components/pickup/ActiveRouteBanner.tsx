'use client';

import Link from 'next/link';
import { Truck } from 'lucide-react';

interface ActiveRouteBannerProps {
  code: string;
  startedAt: string;
  manifestCount: number;
}

/**
 * Pinned at the top of the pickup landing whenever the driver has an
 * in-progress pickup route. Tapping "Ver ruta" jumps into the active-route
 * page where the driver manages linked manifests and closes the route.
 */
export function ActiveRouteBanner({
  code,
  startedAt,
  manifestCount,
}: ActiveRouteBannerProps) {
  const started = new Date(startedAt);
  return (
    <div
      role="status"
      aria-label={`Ruta activa ${code}`}
      data-testid="active-route-banner"
      className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-muted p-3 sm:p-4"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="rounded-full bg-accent/15 p-2">
          <Truck className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-text truncate">{code}</p>
          <p className="text-xs text-text-secondary">
            {manifestCount} manifiestos · iniciada {started.toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>
      <Link
        href="/app/pickup/route/active"
        className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        Ver ruta
      </Link>
    </div>
  );
}
