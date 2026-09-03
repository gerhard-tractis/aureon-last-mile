'use client';

import { ArrowLeft, ScanBarcode } from 'lucide-react';
import type { ComunaCount, IncompleteOrder } from '@/lib/dispatch/mobile/route-load-brief';
import { DispatchComunaBreakdown } from './DispatchComunaBreakdown';
import { DispatchIncompleteOrdersWarning } from './DispatchIncompleteOrdersWarning';
import { DispatchVehicleAssignmentBlock } from './DispatchVehicleAssignmentBlock';

/**
 * spec-76 2c — Antes de escanear. What is on the dock before the crew
 * starts: andén/órdenes/paradas counts, vehicle assignment, the
 * incomplete-orders warning (decision 5), comunas.
 *
 * `onStartScanning` is enabled with no vehicle assigned (decision 6 — the
 * scan loop, `2e`, is `spec-76` task 4, out of this task's scope) and
 * `onAssignVehicle` opens `2d` (task 2, also out of scope) — both are left
 * to the caller so this screen does not have to know what either target
 * looks like yet.
 */
export interface DispatchRouteBeforeScanProps {
  routeCode: string;
  loadPositionLabel: string | null;
  pendingOnDock: number;
  ordersCount: number;
  stopsCount: number;
  vehicleAssignment: { externalVehicleId: string; driverName: string | null } | null;
  incompleteOrders: IncompleteOrder[];
  comunas: ComunaCount[];
  onBack: () => void;
  onStartScanning: () => void;
  onAssignVehicle: () => void;
}

export function DispatchRouteBeforeScan({
  routeCode,
  loadPositionLabel,
  pendingOnDock,
  ordersCount,
  stopsCount,
  vehicleAssignment,
  incompleteOrders,
  comunas,
  onBack,
  onStartScanning,
  onAssignVehicle,
}: DispatchRouteBeforeScanProps) {
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-route-before-scan">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="grid h-11 w-11 place-items-center rounded-full text-text-muted active:opacity-80"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="font-mono text-[15px] font-bold text-accent">{routeCode}</h1>
          {loadPositionLabel && <p className="text-[12px] text-text-secondary">{loadPositionLabel}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-[10px] border border-border bg-surface p-3 text-center">
          <p className="font-mono text-[19px] font-semibold text-text">{pendingOnDock}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[.05em] text-text-muted">En el andén</p>
        </div>
        <div className="rounded-[10px] border border-border bg-surface p-3 text-center">
          <p className="font-mono text-[19px] font-semibold text-text">{ordersCount}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[.05em] text-text-muted">Órdenes</p>
        </div>
        <div className="rounded-[10px] border border-border bg-surface p-3 text-center">
          <p className="font-mono text-[19px] font-semibold text-text">{stopsCount}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[.05em] text-text-muted">Paradas</p>
        </div>
      </div>

      <div>
        <DispatchVehicleAssignmentBlock assignment={vehicleAssignment} onAssign={onAssignVehicle} />
        <p className="mt-1.5 text-[11.5px] text-text-muted">
          DispatchTrack necesita el identificador del camión para aceptar la ruta.
        </p>
      </div>

      <DispatchIncompleteOrdersWarning orders={incompleteOrders} />

      <DispatchComunaBreakdown comunas={comunas} />

      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={onStartScanning}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground active:opacity-90"
        >
          <ScanBarcode className="h-5 w-5" />
          Empezar a escanear
        </button>
        <button
          type="button"
          onClick={onAssignVehicle}
          className="flex min-h-[48px] w-full items-center justify-center rounded-[10px] border border-border text-[14px] font-medium text-text active:opacity-90"
        >
          Asignar camión y conductor
        </button>
      </div>
    </div>
  );
}
