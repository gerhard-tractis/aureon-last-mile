'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouteTrackingBrief } from '@/hooks/dispatch/useRouteTrackingBrief';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import { formatRouteHeaderDate, formatTimeOnly } from '@/lib/utils/dateFormat';
import { RouteTrackingLiveLine } from './RouteTrackingLiveLine';
import { RouteTrackingScanList } from './RouteTrackingScanList';
import { RouteTrackingVehiclePanel } from './RouteTrackingVehiclePanel';

interface Props {
  routeId: string;
  operatorId: string;
}

/**
 * spec-75 phase 4 — `1c`, the read-only route tracking view: the desktop
 * watches the crew scan on mobile, live. Strictly read-only (decision 4):
 * no scan input, no close/seal action mounts here — closing is
 * crew-mobile only (`2i`, spec-77), and dispatching is `1b`'s screen, not
 * this one (the API 409s here anyway unless status is `loaded`, which this
 * view is never shown for — `DispatchRouteSurface` only renders it while
 * `status === 'loading'`).
 */
export function RouteTrackingView({ routeId, operatorId }: Props) {
  const router = useRouter();
  const [showPending, setShowPending] = useState(false);
  const { data: brief, isLoading, isError, refetch } = useRouteTrackingBrief(routeId, operatorId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-5" data-testid="route-tracking-skeleton">
        <Skeleton className="h-9 w-48 rounded-md" />
        <Skeleton className="h-24 w-full rounded-[10px]" />
        <Skeleton className="h-56 w-full rounded-[10px]" />
      </div>
    );
  }

  if (isError || !brief) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-[13.5px] text-status-error-text">No pudimos cargar el seguimiento de esta ruta.</p>
        <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
      </div>
    );
  }

  const lastScan = brief.scans[0] ?? null;
  const firstScan = brief.scans[brief.scans.length - 1] ?? null;

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-53px)] overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden md:border-r border-border">
        <div className="shrink-0 flex flex-col gap-2 px-5 py-3 bg-surface border-b border-border">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/app/dispatch')} className="text-text-muted">
              <ArrowLeft />
            </Button>
            <span className="font-mono text-[15px] font-bold text-accent">{routeCode(routeId)}</span>
            {brief.routeDate && <span className="text-xs text-text-muted">{formatRouteHeaderDate(brief.routeDate)}</span>}
            {brief.loadPositionLabel && <span className="text-xs text-text-muted">{brief.loadPositionLabel}</span>}
            <StatusBadge status="loading" label="EN CARGA" variant="info" size="sm" />
            <Badge variant="outline" data-testid="read-only-badge">SOLO LECTURA</Badge>
          </div>
          {/* Phase-4 review — gated on there being a scan at all, not on
              knowing who made it. A null scannerName (RLS denial, a
              soft-deleted users row) used to take `hace 8 s` and `ritmo
              214/h` down with it too; those don't depend on a name — see
              RouteTrackingLiveLine's own optional scannerName. */}
          {lastScan && firstScan && (
            <RouteTrackingLiveLine
              scannerName={brief.scannerName}
              loadPositionLabel={brief.loadPositionLabel}
              lastScanAtIso={lastScan.loadedAtIso}
              firstScanAtIso={firstScan.loadedAtIso}
              loadedBoxCount={brief.packagesLoadedCount}
            />
          )}
        </div>

        {lastScan ? (
          <div className="shrink-0 px-5 py-4 border-b border-border">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
              Último cargado · Parada {String(lastScan.stopNumber).padStart(2, '0')}
            </h3>
            <p className="text-lg font-semibold text-text">
              {lastScan.orderNumber}
              {lastScan.comuna && ` · ${lastScan.comuna}`}
            </p>
            {lastScan.customerName && <p className="text-[13px] text-text-secondary">{lastScan.customerName}</p>}
            <p className="text-[12px] text-text-muted">
              paquete {lastScan.boxIndexInOrder} de {lastScan.boxesTotalInOrder} · {brief.packagesLoadedCount} en la ruta · {formatTimeOnly(lastScan.loadedAtIso)}
            </p>
          </div>
        ) : (
          <div className="shrink-0 border-b border-border px-5 py-4 text-[13px] text-text-muted">
            Todavía no hay paquetes cargados en esta ruta.
          </div>
        )}

        <div className="shrink-0 border-b border-border px-5 py-3">
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">Paquetes en la ruta</h3>
          <p className="text-[13px] text-text">
            <strong className="font-mono">{brief.packagesLoadedCount}</strong> de {brief.packagesExpectedCount} esperados en el andén
            {brief.packagesUnscannedCount > 0 && ` · ${brief.packagesUnscannedCount} sin escanear`}
          </p>
          {brief.pendingOrders.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowPending((v) => !v)}
                className="mt-1 text-[12px] font-medium text-accent underline"
              >
                {showPending ? 'Ocultar pendientes' : `Ver los ${brief.pendingOrders.length} pendientes`}
              </button>
              {showPending && (
                <ul className="mt-2 flex flex-col gap-1">
                  {brief.pendingOrders.map((o) => (
                    <li key={o.orderId} className="text-[12px] text-text-secondary">
                      {o.orderNumber}
                      {o.comuna && ` · ${o.comuna}`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <RouteTrackingScanList scans={brief.scans} />
      </div>

      <RouteTrackingVehiclePanel
        vehicleExternalId={brief.vehicleExternalId}
        driverName={brief.driverName}
        packagesLoadedCount={brief.packagesLoadedCount}
        vehicleCapacityPackages={brief.vehicleCapacityPackages}
      />
    </div>
  );
}
