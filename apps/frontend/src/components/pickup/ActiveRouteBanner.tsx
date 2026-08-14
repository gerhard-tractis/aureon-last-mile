'use client';

import Link from 'next/link';
import { QrCode, Truck } from 'lucide-react';

interface ActiveRouteBannerProps {
  code: string;
  startedAt: string;
  manifestCount: number;
  routeId: string;
}

/**
 * Pinned at the top of the pickup landing whenever the driver has an
 * in-progress pickup route. Tapping "Ver ruta" jumps into the active-route
 * page where the driver manages linked manifests. The QR affordance is
 * shown alongside it so the driver can present the route QR to reception
 * as soon as the truck reaches the dock, without gating it behind closing
 * the route first.
 */
export function ActiveRouteBanner({
  code,
  startedAt,
  manifestCount,
  routeId,
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
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/app/pickup/route/${routeId}/qr`}
          aria-label="Mostrar QR de la ruta"
          className="rounded-md border border-accent/40 p-2 text-accent hover:bg-accent/10"
        >
          <QrCode className="h-5 w-5" />
        </Link>
        <Link
          href="/app/pickup/route/active"
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Ver ruta
        </Link>
      </div>
    </div>
  );
}
