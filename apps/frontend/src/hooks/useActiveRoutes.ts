import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';

export interface ActiveDispatch {
  id: string;
  external_dispatch_id: string | null;
  order_id: string | null;
  status: 'pending' | 'delivered' | 'failed' | 'partial';
  planned_sequence: number | null;
  estimated_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  latitude: number | null;
  longitude: number | null;
  failure_reason: string | null;
}

export interface ActiveRoute {
  id: string;
  external_route_id: string;
  driver_name: string | null;
  vehicle_id: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  start_time: string | null;
  total_stops: number;
  completed_stops: number;
  dispatches: ActiveDispatch[];
}

export function useActiveRoutes(operatorId: string, routeDate?: string) {
  return useQuery<ActiveRoute[]>({
    queryKey: ['active-routes', operatorId, routeDate ?? 'today'],
    queryFn: async () => {
      const args: Record<string, unknown> = { p_operator_id: operatorId };
      if (routeDate) args.p_route_date = routeDate;

      // callRpc, not `(client.rpc as CallableFunction)(...)` — the cast-the-
      // method form detaches rpc from its receiver and throws. See
      // lib/supabase/rpc.ts.
      const { data, error } = await callRpc<ActiveRoute[]>(
        createSPAClient(),
        'get_active_routes_with_dispatches',
        args,
      );
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    staleTime: 60_000,
  });
}
