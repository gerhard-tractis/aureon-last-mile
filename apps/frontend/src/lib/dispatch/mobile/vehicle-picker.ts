// apps/frontend/src/lib/dispatch/mobile/vehicle-picker.ts
//
// spec-76 task 2 (2d) — pure row-shaping for the "Asignar camión y
// conductor" bottom sheet. Fetching lives in
// hooks/dispatch/mobile/useVehicleAssignmentOptions.ts. Kept dependency-
// free, mirroring crew-board.ts / route-load-brief.ts's split so the
// blocking rule is testable without mocking Supabase.
//
// Two independent reasons a vehicle cannot be tapped, spec-76 decision 6:
//   - 'blocked'      — the vehicle already carries a different route TODAY.
//                       Visible, never hidden, labelled with that route.
//   - 'no_capacity'  — fleet_vehicles.capacity_packages IS NULL (or the
//                       same non-positive/non-finite values
//                       lib/dispatch/vehicle-capacity.ts already treats as
//                       unconfigured). Never draws a fake bar, never
//                       accepts the assignment.
// A vehicle can be both; 'blocked' wins because "this truck is out on
// another route right now" is the more actionable fact for the crew than
// a missing capacity number.

export interface PickerFleetVehicle {
  id: string;
  externalVehicleId: string;
  plateNumber: string | null;
  vehicleType: string | null;
  driverName: string | null;
  capacityPackages: number | null;
}

/** One route, today, that already has this vehicle assigned. */
export interface PickerBusyRoute {
  vehicleId: string;
  routeId: string;
  routeCode: string;
}

export type VehiclePickerBlockReason = 'blocked' | 'no_capacity' | null;

export interface VehiclePickerRow {
  id: string;
  externalVehicleId: string;
  plateNumber: string | null;
  vehicleType: string | null;
  driverName: string | null;
  capacityPackages: number | null;
  assignable: boolean;
  blockReason: VehiclePickerBlockReason;
  blockedByRouteCode: string | null;
}

/** Same "unconfigured" test as getVehicleFillStatus (vehicle-capacity.ts):
 *  null, non-finite, and non-positive all mean "no real number was typed
 *  in" — never a bar/assignment pinned at 0. Duplicated rather than
 *  imported because that module's contract is about a fill *bar*
 *  (packageCount + capacity together); this one only needs the
 *  configured/not-configured half of it. */
export function isCapacityConfigured(capacityPackages: number | null): boolean {
  return capacityPackages != null && Number.isFinite(capacityPackages) && capacityPackages > 0;
}

export function buildVehiclePickerRows(
  vehicles: readonly PickerFleetVehicle[],
  busyRoutesToday: readonly PickerBusyRoute[],
  currentRouteId: string | null,
): VehiclePickerRow[] {
  const busyByVehicle = new Map<string, PickerBusyRoute>();
  for (const busy of busyRoutesToday) {
    // A route already carrying this same route's own assignment is not a
    // conflict — only a DIFFERENT route counts as "already lends it out
    // today". First match wins if a vehicle is (incorrectly) on more than
    // one other route today; naming one is still honest and better than
    // naming none.
    if (busy.routeId === currentRouteId) continue;
    if (!busyByVehicle.has(busy.vehicleId)) busyByVehicle.set(busy.vehicleId, busy);
  }

  return vehicles.map((v) => {
    const busy = busyByVehicle.get(v.id) ?? null;
    const configured = isCapacityConfigured(v.capacityPackages);

    let blockReason: VehiclePickerBlockReason = null;
    if (busy) blockReason = 'blocked';
    else if (!configured) blockReason = 'no_capacity';

    return {
      id: v.id,
      externalVehicleId: v.externalVehicleId,
      plateNumber: v.plateNumber,
      vehicleType: v.vehicleType,
      driverName: v.driverName,
      capacityPackages: v.capacityPackages,
      assignable: blockReason === null,
      blockReason,
      blockedByRouteCode: busy?.routeCode ?? null,
    };
  });
}
