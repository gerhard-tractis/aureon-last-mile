/**
 * useAuditLogsOps — ops-manager audit log viewer hook
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 *
 * Separate from useAuditLogs (Story 1.6 admin hook).
 * Queries audit_logs directly via the Supabase client, filtered by operator_id.
 */

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  operator_id: string;
  user_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  changes_json: Record<string, unknown> | null;
  ip_address: string | null;
  timestamp: string;
  /** Joined user data — present when joined in select */
  user?: {
    full_name: string;
    role: string;
    email: string;
  };
}

export interface AuditLogsOpsFilter {
  /** 'YYYY-MM-DD' — default: 7 days ago */
  dateFrom?: string;
  /** 'YYYY-MM-DD' — default: today */
  dateTo?: string;
  /** Filter by specific user UUID */
  userId?: string;
  /** Filter by action prefix: 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL' */
  actionType?: 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  /** Filter by table_name: 'orders' | 'packages' | 'manifests' | 'users' |
   *  'fleet_vehicles' | 'routes' | 'dispatches' | 'all' */
  resourceType?: string;
  /** ilike search on resource_id */
  search?: string;
  /** 1-based page number (default: 1) */
  page?: number;
  /** Records per page (default: 50) */
  pageSize?: number;
}

// ── Default helpers ───────────────────────────────────────────────────────────

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function defaultDateTo(): string {
  return new Date().toISOString().split('T')[0];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useAuditLogsOps
 *
 * Fetches audit_logs rows for the given operator with pagination and filtering.
 * Always filters by operator_id. Returns { data, count, isLoading, isError }.
 */
export function useAuditLogsOps(
  operatorId: string | null,
  filters: AuditLogsOpsFilter = {},
) {
  const {
    dateFrom = defaultDateFrom(),
    dateTo = defaultDateTo(),
    userId,
    actionType,
    resourceType,
    search,
    page = 1,
    pageSize = 50,
  } = filters;

  const query = useQuery({
    queryKey: ['auditLogsOps', operatorId, filters],
    queryFn: async () => {
      const supabase = createSPAClient();
      const offset = (page - 1) * pageSize;

      // Build select — join users for display
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from('audit_logs') as any)
        .select(
          `id,
           operator_id,
           user_id,
           action,
           resource_type,
           resource_id,
           changes_json,
           ip_address,
           timestamp`,
          { count: 'exact' },
        )
        .eq('operator_id', operatorId!)
        .gte('timestamp', `${dateFrom}T00:00:00.000Z`)
        .lte('timestamp', `${dateTo}T23:59:59.999Z`);

      if (userId) {
        q = q.eq('user_id', userId);
      }

      if (resourceType && resourceType !== 'all') {
        q = q.eq('resource_type', resourceType);
      }

      if (actionType && actionType !== 'ALL') {
        q = q.ilike('action', `${actionType}%`);
      }

      if (search) {
        q = q.ilike('resource_id', `%${search}%`);
      }

      q = q.order('timestamp', { ascending: false });
      q = q.range(offset, offset + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;

      return {
        data: (data as AuditLogEntry[]) ?? [],
        count: count as number | null,
      };
    },
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    data: query.data?.data ?? [],
    count: query.data?.count ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
    fetchStatus: query.fetchStatus,
  };
}
