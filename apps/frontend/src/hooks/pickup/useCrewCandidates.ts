import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * Review round 1 (spec-95 fase 4) — the "van roles" this hook fetches, named
 * ONCE. Before this, the `.in('role', [...])` array below and CrewSelect's
 * role-label map were two independently-typed literals; adding a role to one
 * without the other (e.g. `warehouse_staff` sneaking into the query) would
 * have compiled clean and silently mislabelled that person "conductor" in
 * the UI. `CrewCandidate.role: CrewRole` plus a `Record<CrewRole, string>`
 * label map in CrewSelect.tsx makes that impossible: an added role here that
 * is missing from the label map is a compile error, not a runtime guess.
 */
export const CREW_ROLES = ['pickup_crew', 'pickup_leader', 'ops_leader'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export interface CrewCandidate {
  id: string;
  full_name: string | null;
  role: CrewRole;
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
        // spec-66 — an ops_leader both leads its own route and rides on
        // someone else's, so it must appear here as well as in
        // ROUTE_LEADER_ROLES. Omitting it would leave an ops_leader unable to
        // lead OR join, which is the dead end spec-66 exists to remove.
        .in('role', CREW_ROLES)
        .is('deleted_at', null)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return ((data as CrewCandidate[]) ?? []).filter((u) => u.id !== excludeUserId);
    },
  });
}
