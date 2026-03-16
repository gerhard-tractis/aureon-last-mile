/**
 * useAuditLogUsers — fetches user list for the audit log viewer filter dropdown
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 */

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuditLogUser {
  id: string;
  email: string;
  full_name: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useAuditLogUsers
 *
 * Fetches non-deleted users for the given operator, ordered by full_name.
 * Used to populate the "filter by user" dropdown in the audit log viewer.
 * staleTime: 5 minutes (user lists change rarely).
 */
export function useAuditLogUsers(operatorId: string | null) {
  const query = useQuery({
    queryKey: ['auditLogUsers', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('users') as any)
        .select('id, email, full_name')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('full_name', { ascending: true });

      if (error) throw error;
      return (data as AuditLogUser[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 300_000, // 5 min — user list changes rarely
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
    fetchStatus: query.fetchStatus,
  };
}
