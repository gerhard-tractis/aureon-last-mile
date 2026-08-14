import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

export type PickupRouteRow = Database['public']['Tables']['pickup_routes']['Row'];

interface ReopenArgs {
  routeId: string;
}

/**
 * Undo for a reception opened by mistake — a QR scanned before the truck was
 * actually unloaded. `reopen_pickup_route` rewinds the route to `in_progress`,
 * soft-deletes the empty batch, clears `in_transit_at` and releases the
 * pickup-scan lock so the driver can keep working.
 *
 * The RPC refuses once any `reception_scans` exist, and raises a *named*
 * Spanish error when the driver has since started a replacement route. Both
 * messages are written for the receptionist to read, so callers must surface
 * `error.message` verbatim rather than a generic failure string.
 */
export function useReopenRouteReception() {
  const queryClient = useQueryClient();

  return useMutation<PickupRouteRow, Error, ReopenArgs>({
    mutationFn: async ({ routeId }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('reopen_pickup_route', {
        p_route_id: routeId,
      });
      if (error) throw error;
      return data as PickupRouteRow;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reception', 'incoming-routes'] });
      queryClient.invalidateQueries({
        queryKey: ['reception', 'route-snapshot', variables.routeId],
      });
      queryClient.invalidateQueries({
        queryKey: ['reception', 'route-preview', variables.routeId],
      });
    },
  });
}
