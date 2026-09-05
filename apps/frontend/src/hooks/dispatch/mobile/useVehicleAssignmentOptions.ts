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
import { OPEN_ROUTE_STATUSES } from '@/lib/dispatch/types';
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

      // Review D1 — a vehicle with no external_vehicle_id used to be
      // filtered out here. Decision 6's rule is "visible, never hidden";
      // buildVehiclePickerRows renders it as a third, distinct block
      // reason ('sin_identificador') instead of dropping it silently.
      const vehicles: PickerFleetVehicle[] = (vehicleRows ?? []).map((v) => ({
        id: v.id as string,
        externalVehicleId: v.external_vehicle_id ?? null,
        plateNumber: v.plate_number ?? null,
        vehicleType: v.vehicle_type ?? null,
        driverName: v.driver_name ?? null,
        capacityPackages: v.capacity_packages ?? null,
      }));

      // spec-79 round 8 B-1: this guard is a client-side copy of the one
      // PATCH /api/dispatch/routes/[id] enforces server-side (busyRoutes,
      // M7/H6) — it must not diverge from it, in either axis:
      //
      //   - Status set: OPEN_ROUTE_STATUSES, not ACTIVE_ROUTE_STATUSES.
      //     Fase 0 finding 3 — "un camión puede legítimamente correr dos
      //     rutas el mismo día" — means a truck already `dispatched` on
      //     its morning route is NOT busy for the purposes of a NEW
      //     assignment; only another still-OPEN (undispatched) route is a
      //     genuine double-booking. Importing the SAME constant the server
      //     guard uses (rather than a locally re-declared array) is what
      //     keeps the two from drifting again — see
      //     useVehicleAssignmentOptions.test.ts's B-1 case.
      //   - Date axis: the CURRENT route's own route_date, not "today"
      //     (todayISOInTimezone()). A route dated for another day must be
      //     checked against bookings on ITS date, not today's — fetched
      //     below before the busy-routes query can run.
      const { data: currentRoute, error: currentRouteError } = await supabase
        .from('routes')
        .select('route_date')
        .eq('id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .single();
      if (currentRouteError) throw currentRouteError;

      const { data: routeRows, error: routesError } = await supabase
        .from('routes')
        .select('id, vehicle_id')
        .eq('operator_id', operatorId!)
        .eq('route_date', currentRoute.route_date)
        .is('deleted_at', null)
        .not('vehicle_id', 'is', null)
        .in('status', OPEN_ROUTE_STATUSES);
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
