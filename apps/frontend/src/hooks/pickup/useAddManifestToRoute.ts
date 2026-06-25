import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

type Manifest = Database['public']['Tables']['manifests']['Row'];

interface AddArgs {
  routeId: string;
  manifestId: string;
}

/** Calls `add_manifest_to_route(p_route_id, p_manifest_id)`. */
export function useAddManifestToRoute(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<Manifest, Error, AddArgs>({
    mutationFn: async ({ routeId, manifestId }) => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('add_manifest_to_route', {
        p_route_id: routeId,
        p_manifest_id: manifestId,
      });
      if (error) throw error;
      return data as Manifest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'route-manifests'] });
      qc.invalidateQueries({ queryKey: ['pickup', 'active-route', operatorId] });
      qc.invalidateQueries({ queryKey: ['pickup', 'manifests'] });
    },
  });
}
