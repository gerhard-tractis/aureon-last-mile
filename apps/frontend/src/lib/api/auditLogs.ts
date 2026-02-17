/**
 * Audit Logs API Client
 * Type-safe API client for audit log retrieval and export
 * Story 1.6: Set Up Audit Logging Infrastructure
 */

export interface AuditLog {
  id: string;
  operator_id: string;
  user_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  changes_json: Record<string, unknown> | null;
  ip_address: string | null;
  timestamp: string;
  // Joined fields (populated by API)
  user?: {
    full_name: string;
    role: string;
    email: string;
  };
}

export interface AuditLogsFilter {
  date_from?: string; // ISO date string
  date_to?: string; // ISO date string
  user_id?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogsResponse {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Fetch audit logs with filters
 * GET /api/audit-logs
 */
export const getAuditLogs = async (filters: AuditLogsFilter = {}): Promise<AuditLogsResponse> => {
  // Build query params
  const params = new URLSearchParams();

  if (filters.date_from) params.append('date_from', filters.date_from);
  if (filters.date_to) params.append('date_to', filters.date_to);
  if (filters.user_id) params.append('user_id', filters.user_id);
  if (filters.action) params.append('action', filters.action);
  if (filters.resource_type) params.append('resource_type', filters.resource_type);
  if (filters.resource_id) params.append('resource_id', filters.resource_id);
  if (filters.search) params.append('search', filters.search);
  if (filters.page) params.append('page', filters.page.toString());
  if (filters.limit) params.append('limit', filters.limit.toString());

  const response = await fetch(`/api/audit-logs?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    cache: 'no-store' // Disable caching for fresh data
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.message || 'Failed to fetch audit logs');
  }

  return response.json();
};

/**
 * Export audit logs as CSV
 * GET /api/audit-logs/export
 */
export const exportAuditLogs = async (filters: AuditLogsFilter = {}): Promise<Blob> => {
  // Build query params (same as getAuditLogs)
  const params = new URLSearchParams();

  if (filters.date_from) params.append('date_from', filters.date_from);
  if (filters.date_to) params.append('date_to', filters.date_to);
  if (filters.user_id) params.append('user_id', filters.user_id);
  if (filters.action) params.append('action', filters.action);
  if (filters.resource_type) params.append('resource_type', filters.resource_type);
  if (filters.resource_id) params.append('resource_id', filters.resource_id);
  if (filters.search) params.append('search', filters.search);

  const response = await fetch(`/api/audit-logs/export?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.message || 'Failed to export audit logs');
  }

  return response.blob();
};
