'use client';

import type { ReactNode } from 'react';
import { Truck, Layers, Package, Clock, Eye } from 'lucide-react';
import type { RoutePreview } from '@/hooks/reception/useRoutePreview';

interface RoutePreviewCardProps {
  route: RoutePreview;
  /** Optional action slot — e.g. the "Recibir sin QR" fallback. */
  children?: ReactNode;
}

/**
 * Read-only card for a truck the hub can see but has not received yet.
 *
 * Purely presentational by design: no hooks, no queries, no mutation. Tapping
 * an `in_progress` route must never open a reception — that would stamp a
 * false arrival, freeze `expected_count` mid-trip and lock the driver out of
 * scanning. Opening stays behind the QR or the confirmed fallback rendered
 * into `children`.
 */
export function RoutePreviewCard({ route, children }: RoutePreviewCardProps) {
  const isOnTheRoad = route.status === 'in_progress';

  return (
    <div
      data-testid="route-preview-card"
      className="bg-surface border border-border rounded-lg p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-lg font-semibold text-text">{route.code}</p>
        <span className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
          <Eye className="h-3 w-3" />
          {isOnTheRoad ? 'En ruta · solo lectura' : 'Solo lectura'}
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-sm text-text-secondary flex items-center gap-1">
          <Truck className="h-3.5 w-3.5" />
          {route.driver_name ?? 'Sin chofer asignado'}
          <span className="mx-1">·</span>
          {route.vehicle_plate ?? 'Sin patente'}
        </p>

        <p className="text-sm text-text-secondary flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" />
          {route.manifest_count} carga{route.manifest_count === 1 ? '' : 's'}
          <span className="mx-1">·</span>
          <Package className="h-3.5 w-3.5" />
          {route.scanned_count} paquetes escaneados
        </p>

        {route.started_at && (
          <p className="text-xs text-text-muted flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Inició{' '}
            {new Date(route.started_at).toLocaleString('es-CL', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>

      <p className="text-xs text-text-muted">
        El chofer sigue retirando. Los paquetes esperados se congelan recién al
        escanear el QR de llegada.
      </p>

      {children}
    </div>
  );
}
