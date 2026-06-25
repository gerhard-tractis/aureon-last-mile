import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

export type RouteReception = Database['public']['Tables']['route_receptions']['Row'];

interface CloseArgs {
  routeId: string;
}

/**
 * Calls `close_pickup_route(p_route_id)` → returns the freshly-created
 * route_receptions row so the caller can navigate to the QR view.
 */
export function useClosePickupRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<RouteReception, Error, CloseArgs>({
    mutationFn: async ({ routeId }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('close_pickup_route', {
        p_route_id: routeId,
      });
      if (error) throw error;
      return data as RouteReception;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
      qc.invalidateQueries({ queryKey: ['pickup', 'route-manifests'] });
    },
  });
}
