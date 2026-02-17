'use client';

/**
 * Audit Logs Page Client Component
 * Story 1.6: Set Up Audit Logging Infrastructure
 */

import { useState } from 'react';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { AuditLogFilters } from '@/components/admin/AuditLogFilters';
import { AuditLogTable } from '@/components/admin/AuditLogTable';
import type { AuditLogsFilter } from '@/lib/api/auditLogs';

export const AuditLogsPageClient = () => {
  // Initialize filters with default: last 7 days
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [filters, setFilters] = useState<AuditLogsFilter>({
    date_from: sevenDaysAgo.toISOString(),
    date_to: now.toISOString(),
    page: 1,
    limit: 50
  });

  const { data, isLoading, error } = useAuditLogs(filters);

  const handleFiltersChange = (newFilters: AuditLogsFilter) => {
    setFilters(newFilters);
  };

  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Audit Logs</h1>
          <p className="mt-2 text-sm text-gray-600">
            View system activity and security events. All data access and modifications are logged for compliance and investigation.
          </p>
        </div>

        {/* Filters */}
        <AuditLogFilters filters={filters} onFiltersChange={handleFiltersChange} />

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <div className="flex items-center justify-center">
              <svg className="animate-spin h-8 w-8 text-[#e6c15c]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="ml-3 text-gray-600">Loading audit logs...</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error loading audit logs</h3>
                <p className="mt-1 text-sm text-red-700">{error.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {!isLoading && !error && data && (
          <AuditLogTable
            logs={data.data}
            total={data.total}
            page={data.page}
            limit={data.limit}
            onPageChange={handlePageChange}
          />
        )}
      </div>
    </div>
  );
};
