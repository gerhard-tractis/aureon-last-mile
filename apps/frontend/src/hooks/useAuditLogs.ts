/**
 * TanStack Query hooks for audit logs
 * Story 1.6: Set Up Audit Logging Infrastructure
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { getAuditLogs, exportAuditLogs, type AuditLogsFilter } from '@/lib/api/auditLogs';
import { toast } from 'sonner';

/**
 * useAuditLogs - Query hook for fetching audit logs
 *
 * Automatically filtered by operator_id via RLS policy
 * Supports filtering by date range, user, action, resource
 */
export const useAuditLogs = (filters: AuditLogsFilter = {}) => {
  return useQuery({
    queryKey: ['auditLogs', filters],
    queryFn: () => getAuditLogs(filters),
    staleTime: 30000, // Fresh for 30 seconds (audit logs are relatively static)
    refetchOnWindowFocus: true,
    // Don't fetch if filters are incomplete (e.g., no date range set)
    enabled: true
  });
};

/**
 * useExportAuditLogs - Mutation hook for exporting audit logs as CSV
 *
 * On success: Downloads CSV file
 * On error: Shows error toast
 */
export const useExportAuditLogs = () => {
  return useMutation({
    mutationFn: (filters: AuditLogsFilter) => exportAuditLogs(filters),
    onSuccess: (blob, _filters) => {
      // Generate filename: audit_logs_{operator}_{date}.csv
      const date = new Date().toISOString().split('T')[0];
      const filename = `audit_logs_${date}.csv`;

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success('Audit logs exported successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to export audit logs: ${error.message}`);
    }
  });
};
