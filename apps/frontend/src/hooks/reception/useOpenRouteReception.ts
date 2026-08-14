import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

export type RouteReceptionRow =
  Database['public']['Tables']['route_receptions']['Row'];

interface OpenArgs {
  routeId: string;
}

/**
 * Opens the hub reception for an arriving pickup route — the receptionist's
 * scan is what ends the trip (spec-52). `open_route_reception` does the whole
 * arrival in one transaction: status check, batch creation, `in_transit_at`
 * stamp, manifests to `awaiting_reception`, `expected_count` frozen from the
 * verified pickup scans, and the `pickup_scans` route lock.
 *
 * It has real, driver-visible side effects — it freezes the expectation and
 * blocks further pickup scanning — so it must only ever be reached from a QR
 * scan or the confirmed "Recibir sin QR" fallback. Never call it on mount.
 * It is idempotent: a second scan returns the existing batch untouched.
 */
export function useOpenRouteReception() {
  const queryClient = useQueryClient();

  return useMutation<RouteReceptionRow, Error, OpenArgs>({
    mutationFn: async ({ routeId }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('open_route_reception', {
        p_route_id: routeId,
      });
      if (error) throw error;
      return data as RouteReceptionRow;
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
