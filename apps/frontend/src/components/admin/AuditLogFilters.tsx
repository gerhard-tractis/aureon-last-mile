'use client';

/**
 * Audit Log Filters Component
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Features:
 * - Date range picker with presets (Today, Yesterday, Last 7 days, Last 30 days, Custom)
 * - User dropdown (multi-select)
 * - Action dropdown (multi-select)
 * - Resource type dropdown (multi-select)
 * - Search input (searches resource_id, action, changes_json)
 * - Export CSV button
 */

import { useState } from 'react';
import { useUsers } from '@/hooks/useUsers';
import { useExportAuditLogs } from '@/hooks/useAuditLogs';
import type { AuditLogsFilter } from '@/lib/api/auditLogs';

interface AuditLogFiltersProps {
  filters: AuditLogsFilter;
  onFiltersChange: (filters: AuditLogsFilter) => void;
}

export const AuditLogFilters = ({ filters, onFiltersChange }: AuditLogFiltersProps) => {
  const { data: users } = useUsers();
  const { mutate: exportLogs, isPending: isExporting } = useExportAuditLogs();

  const [datePreset, setDatePreset] = useState<string>('last_7_days');

  // Date presets
  // FIX #14: Avoid mutating date objects to prevent calculation bugs
  const applyDatePreset = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    let date_from: string;
    let date_to: string = now.toISOString();

    switch (preset) {
      case 'today':
        // Use new Date() to avoid mutating 'now'
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        date_from = todayStart.toISOString();
        break;
      case 'yesterday':
        // Create separate date objects to avoid mutation
        const yesterdayStart = new Date(now);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        yesterdayStart.setHours(0, 0, 0, 0);
        date_from = yesterdayStart.toISOString();

        const yesterdayEnd = new Date(now);
        yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
        yesterdayEnd.setHours(23, 59, 59, 999);
        date_to = yesterdayEnd.toISOString();
        break;
      case 'last_7_days':
        date_from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'last_30_days':
        date_from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        break;
      default:
        // Custom - don't change dates
        return;
    }

    onFiltersChange({ ...filters, date_from, date_to });
  };

  const handleExport = () => {
    exportLogs(filters);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Date range preset */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date Range
          </label>
          <select
            value={datePreset}
            onChange={(e) => applyDatePreset(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Custom date from */}
        {datePreset === 'custom' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From
              </label>
              <input
                type="datetime-local"
                value={filters.date_from ? new Date(filters.date_from).toISOString().slice(0, 16) : ''}
                onChange={(e) => onFiltersChange({ ...filters, date_from: new Date(e.target.value).toISOString() })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To
              </label>
              <input
                type="datetime-local"
                value={filters.date_to ? new Date(filters.date_to).toISOString().slice(0, 16) : ''}
                onChange={(e) => onFiltersChange({ ...filters, date_to: new Date(e.target.value).toISOString() })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
              />
            </div>
          </>
        )}

        {/* User filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            User
          </label>
          <select
            value={filters.user_id || ''}
            onChange={(e) => onFiltersChange({ ...filters, user_id: e.target.value || undefined, page: 1 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
          >
            <option value="">All Users</option>
            {users?.map(user => (
              <option key={user.id} value={user.id}>
                {user.full_name} ({user.role})
              </option>
            ))}
          </select>
        </div>

        {/* Action filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Action
          </label>
          <select
            value={filters.action || ''}
            onChange={(e) => onFiltersChange({ ...filters, action: e.target.value || undefined, page: 1 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
          >
            <option value="">All Actions</option>
            <option value="INSERT_users">INSERT users</option>
            <option value="UPDATE_users">UPDATE users</option>
            <option value="DELETE_users">DELETE users</option>
            <option value="INSERT_orders">INSERT orders</option>
            <option value="UPDATE_orders">UPDATE orders</option>
            <option value="DELETE_orders">DELETE orders</option>
            <option value="INSERT_manifests">INSERT manifests</option>
            <option value="UPDATE_manifests">UPDATE manifests</option>
            <option value="DELETE_manifests">DELETE manifests</option>
          </select>
        </div>

        {/* Resource type filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resource Type
          </label>
          <select
            value={filters.resource_type || ''}
            onChange={(e) => onFiltersChange({ ...filters, resource_type: e.target.value || undefined, page: 1 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
          >
            <option value="">All Resources</option>
            <option value="users">Users</option>
            <option value="orders">Orders</option>
            <option value="manifests">Manifests</option>
          </select>
        </div>

        {/* Search input */}
        <div className="md:col-span-2 lg:col-span-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Search
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search resource ID, action, or changes..."
              value={filters.search || ''}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value || undefined, page: 1 })}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent"
            />
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 bg-[#e6c15c] text-gray-900 rounded-md hover:bg-[#d4b04a] font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
            >
              {isExporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export CSV
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
