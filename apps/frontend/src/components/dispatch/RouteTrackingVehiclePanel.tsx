'use client';

import { VehicleCapacityBar } from './VehicleCapacityBar';
import { getVehicleFillStatus } from '@/lib/dispatch/vehicle-capacity';

interface Props {
  vehicleExternalId: string | null;
  driverName: string | null;
  packagesLoadedCount: number;
  vehicleCapacityPackages: number | null;
}

/**
 * spec-75 phase 4 (`1c`) — "VEHÍCULO Y CONDUCTOR" with occupancy
 * ("Ocupación con 148 paquetes · 92 %"). Reuses `VehicleCapacityBar` +
 * `getVehicleFillStatus` verbatim (decision 3 / this task's own
 * constraint 3) — capacity is `fleet_vehicles.capacity_packages`, never
 * the separate `vehicles` table, and `NULL` renders no bar at all.
 *
 * `VehicleCapacityBar` itself renders nothing for the unconfigured case
 * (by design — see its own header comment); this panel adds the explicit
 * "Sin capacidad configurada" text the brief asks for ("say so, never draw
 * a fake bar") on top of that, since silence alone doesn't tell a reader
 * capacity is simply unset rather than the bar having failed to load.
 */
export function RouteTrackingVehiclePanel({
  vehicleExternalId,
  driverName,
  packagesLoadedCount,
  vehicleCapacityPackages,
}: Props) {
  const fillStatus = getVehicleFillStatus(packagesLoadedCount, vehicleCapacityPackages);

  return (
    <div className="w-full md:w-[340px] shrink-0 flex flex-col gap-4 bg-surface border-l-[1.5px] border-border px-5 py-[18px]">
      <h3 className="text-[10px] font-bold tracking-widest uppercase text-text-muted">Vehículo y conductor</h3>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[15px] font-semibold text-text">
          {vehicleExternalId ?? 'Sin vehículo asignado'}
        </span>
        <span className="text-[13px] text-text-secondary">{driverName ?? 'Sin conductor'}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.06em] text-text-muted">
          Ocupación con {packagesLoadedCount} paquete{packagesLoadedCount === 1 ? '' : 's'}
        </span>
        {fillStatus.configured ? (
          <VehicleCapacityBar status={fillStatus} />
        ) : (
          <p className="text-[12.5px] text-text-muted">Sin capacidad configurada</p>
        )}
      </div>
    </div>
  );
}
