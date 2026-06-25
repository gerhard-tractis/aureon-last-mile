import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

export type RouteReception = Database['public']['Tables']['route_receptions']['Row'];

interface CompleteArgs {
  routeId: string;
  discrepancyNotes?: string | null;
}

/**
 * Finalize a consolidated reception. Calls `complete_route_reception`
 * which flips `route_receptions.status='completed'` (the DB trigger then
 * cascades manifest statuses and the parent pickup_route). When
 * received < expected the RPC requires `p_discrepancy_notes` to be
 * non-null — the UI gates the button behind a notes modal.
 */
export function useCompleteRouteReception() {
  const queryClient = useQueryClient();

  return useMutation<RouteReception, Error, CompleteArgs>({
    mutationFn: async ({ routeId, discrepancyNotes = null }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('complete_route_reception', {
        p_route_id: routeId,
        p_discrepancy_notes: discrepancyNotes,
      });
      if (error) throw error;
      return data as RouteReception;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['reception', 'route-snapshot', variables.routeId],
      });
      queryClient.invalidateQueries({
        queryKey: ['reception', 'incoming-routes'],
      });
    },
  });
}
