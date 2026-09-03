// apps/frontend/src/hooks/dispatch/mobile/useVehicleAssignmentOptions.ts
//
// spec-76 task 2 (2d) — fetching for the "Asignar camión y conductor" sheet.
// Rule 7 (this module's Lecciones aplicadas): `enabled: false` stops the
// fetch, not the QueryObserver — this hook must only be MOUNTED once the
// sheet actually opens (the sheet component itself only renders its content
// while `open`), not merely gated with `enabled` from a parent that is
// always mounted.
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { ACTIVE_ROUTE_STATUSES } from '@/lib/dispatch/types';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import {
  buildVehiclePickerRows,
  type PickerBusyRoute,
  type PickerFleetVehicle,
  type VehiclePickerRow,
} from '@/lib/dispatch/mobile/vehicle-picker';

interface Options {
  enabled?: boolean;
}

export function useVehicleAssignmentOptions(
  routeId: string | null,
  operatorId: string | null,
  options: Options = {},
) {
  const enabled = (options.enabled ?? true) && !!routeId && !!operatorId;

  return useQuery<VehiclePickerRow[]>({
    queryKey: ['dispatch', 'mobile', 'vehicle-assignment-options', routeId, operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();

      const { data: vehicleRows, error: vehiclesError } = await supabase
        .from('fleet_vehicles')
        .select('id, external_vehicle_id, plate_number, vehicle_type, driver_name, capacity_packages')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('external_vehicle_id', { ascending: true });
      if (vehiclesError) throw vehiclesError;

      const vehicles: PickerFleetVehicle[] = (vehicleRows ?? [])
        .filter((v) => !!v.external_vehicle_id)
        .map((v) => ({
          id: v.id as string,
          externalVehicleId: v.external_vehicle_id as string,
          plateNumber: v.plate_number ?? null,
          vehicleType: v.vehicle_type ?? null,
          driverName: v.driver_name ?? null,
          capacityPackages: v.capacity_packages ?? null,
        }));

      // "Already carrying another route today" (spec-76 decision 6) is a
      // date-scoped question — Lecciones aplicadas #9. route_date is a
      // plain DATE column (YYYY-MM-DD), so it compares directly against
      // todayISOInTimezone()'s Santiago-civil-date string with no further
      // conversion.
      const { data: routeRows, error: routesError } = await supabase
        .from('routes')
        .select('id, vehicle_id')
        .eq('operator_id', operatorId!)
        .eq('route_date', todayISOInTimezone())
        .is('deleted_at', null)
        .not('vehicle_id', 'is', null)
        .in('status', ACTIVE_ROUTE_STATUSES);
      if (routesError) throw routesError;

      const busyRoutesToday: PickerBusyRoute[] = (routeRows ?? [])
        .filter((r) => !!r.vehicle_id)
        .map((r) => ({
          vehicleId: r.vehicle_id as string,
          routeId: r.id as string,
          routeCode: routeCode(r.id as string),
        }));

      return buildVehiclePickerRows(vehicles, busyRoutesToday, routeId);
    },
    enabled,
    staleTime: 10_000,
  });
}
