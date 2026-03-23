'use client';

/**
 * Audit Log Table Component
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Features:
 * - Displays audit logs in table format
 * - Columns: Timestamp, User, Action, Resource, Details (expandable JSON), IP Address
 * - Default sort: Timestamp DESC
 * - Click row to expand/collapse changes_json
 * - Pagination: 50 logs per page
 */

import { useState } from 'react';
import type { AuditLog } from '@/lib/api/auditLogs';
import { formatDateTime } from '@/lib/utils/dateFormat';

interface AuditLogTableProps {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export const AuditLogTable = ({ logs, total, page, limit, onPageChange }: AuditLogTableProps) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (logId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedRows(newExpanded);
  };

  const formatTimestamp = (timestamp: string) => formatDateTime(timestamp);

  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first, last, current, and surrounding pages
      pages.push(1);

      if (page > 3) {
        pages.push('...');
      }

      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) {
        pages.push('...');
      }

      pages.push(totalPages);
    }

    return pages;
  };

  if (logs.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <svg className="mx-auto h-12 w-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-foreground">No audit logs found</h3>
        <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or date range.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Timestamp
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                User
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Action
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Resource
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                IP Address
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {logs.map((log) => (
              <>
                <tr
                  key={log.id}
                  onClick={() => toggleRow(log.id)}
                  className="hover:bg-muted cursor-pointer transition-colors"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedRows.has(log.id)}
                  aria-label={`Audit log entry: ${log.action} by ${log.user?.full_name || 'Unknown'} at ${formatTimestamp(log.timestamp)}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleRow(log.id);
                    }
                  }}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                    {formatTimestamp(log.timestamp)}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    <div className="font-medium">{log.user?.full_name || 'Unknown'}</div>
                    <div className="text-muted-foreground text-xs">{log.user?.role || 'N/A'}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      log.action.startsWith('INSERT') ? 'bg-status-success-bg text-status-success' :
                      log.action.startsWith('UPDATE') ? 'bg-status-info-bg text-status-info' :
                      log.action.startsWith('DELETE') ? 'bg-status-error-bg text-status-error' :
                      'bg-muted text-foreground'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    <div className="font-medium">{log.resource_type || 'N/A'}</div>
                    <div className="text-muted-foreground text-xs font-mono truncate max-w-xs">
                      {log.resource_id || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                    {log.ip_address || 'unknown'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(log.id);
                      }}
                      className="text-gold hover:text-primary-600 font-medium"
                      aria-label={expandedRows.has(log.id) ? 'Hide details' : 'Show details'}
                      aria-expanded={expandedRows.has(log.id)}
                    >
                      {expandedRows.has(log.id) ? 'Hide' : 'Show'}
                    </button>
                  </td>
                </tr>
                {expandedRows.has(log.id) && (
                  <tr key={`${log.id}-details`}>
                    <td colSpan={6} className="px-4 py-3 bg-muted">
                      <div className="text-sm">
                        <div className="font-medium text-foreground mb-2">Changes JSON:</div>
                        {log.changes_json ? (
                          <pre className="bg-card p-3 rounded border border-border overflow-x-auto text-xs font-mono">
                            {JSON.stringify(log.changes_json, null, 2)}
                          </pre>
                        ) : (
                          <div className="text-muted-foreground italic">No changes recorded</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="bg-muted px-4 py-3 border-t border-border sm:px-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-foreground">
            Showing <span className="font-medium">{start}</span> to <span className="font-medium">{end}</span> of{' '}
            <span className="font-medium">{total}</span> logs
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="px-3 py-1 border border-border rounded-md text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Go to previous page"
            >
              Previous
            </button>
            {getPageNumbers().map((pageNum, idx) => (
              pageNum === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-3 py-1 text-muted-foreground" aria-hidden="true">...</span>
              ) : (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum as number)}
                  className={`px-3 py-1 border rounded-md text-sm font-medium ${
                    page === pageNum
                      ? 'bg-gold text-foreground border-gold'
                      : 'border-border text-foreground hover:bg-muted'
                  }`}
                  aria-label={`Go to page ${pageNum}`}
                  aria-current={page === pageNum ? 'page' : undefined}
                >
                  {pageNum}
                </button>
              )
            ))}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1 border border-border rounded-md text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Go to next page"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
