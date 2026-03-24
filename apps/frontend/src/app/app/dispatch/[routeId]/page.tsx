import { createSSRClient } from '@/lib/supabase/server';
import { RouteBuilder } from '@/components/dispatch/RouteBuilder';
import type { FleetVehicle } from '@/lib/dispatch/types';

export default async function RouteBuilderPage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();
  const operatorId: string = session?.user.app_metadata?.claims?.operator_id ?? '';

  const { data: vehicles } = await supabase
    .from('fleet_vehicles')
    .select('id, external_vehicle_id, plate_number, driver_name, vehicle_type')
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .order('external_vehicle_id');

  return (
    <RouteBuilder
      routeId={routeId}
      operatorId={operatorId}
      vehicles={(vehicles ?? []) as FleetVehicle[]}
    />
  );
}
