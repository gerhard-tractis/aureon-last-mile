import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface CrewCandidate {
  id: string;
  full_name: string | null;
  role: string;
}

/**
 * The people a leader may put on a route (spec-61).
 *
 * A plain `users` read, not an RPC: `users_tenant_isolation_select`
 * (20260216170542:78) already lets any authenticated user see their own
 * operator's users, so there is nothing for a SECURITY DEFINER function to
 * add. Narrowed to the van roles — a warehouse_staff on a pickup route is
 * not a thing anyone has asked for, and a full operator directory in a
 * bottom sheet is unusable on a phone.
 *
 * Availability is NOT filtered here. `start_pickup_route` refuses a picker
 * who is already out, naming their route (migration 20260820000003), and
 * that named refusal is more useful than a name silently missing from the
 * list — the leader would just conclude the app is broken.
 */
export function useCrewCandidates(operatorId: string | null, excludeUserId: string | null) {
  return useQuery<CrewCandidate[]>({
    queryKey: ['pickup', 'crew-candidates', operatorId, excludeUserId],
    enabled: !!operatorId,
    staleTime: 300_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('users') as any)
        .select('id, full_name, role')
        .eq('operator_id', operatorId!)
        .in('role', ['pickup_crew', 'pickup_leader'])
        .is('deleted_at', null)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return ((data as CrewCandidate[]) ?? []).filter((u) => u.id !== excludeUserId);
    },
  });
}
