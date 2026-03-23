'use client';

/**
 * User Table Component
 * Displays users in a sortable table with edit/delete actions
 */

import { useMemo } from 'react';
import { useAdminStore } from '@/stores/adminStore';
import { formatDateTimeShort } from '@/lib/utils/dateFormat';
import { getRoleColor, getRoleDisplayName } from '@/lib/validation/userSchema';
import type { User } from '@/lib/api/users';

interface UserTableProps {
  users: User[];
  isLoading: boolean;
}

export const UserTable = ({ users, isLoading }: UserTableProps) => {
  const { sortBy, sortOrder, toggleSort, setEditFormOpen, setDeleteConfirmOpen } = useAdminStore();

  // Sort users based on current sort state
  const sortedUsers = useMemo(() => {
    if (!users) return [];

    return [...users].sort((a, b) => {
      let compareA: string | number = a[sortBy];
      let compareB: string | number = b[sortBy];

      // Handle date comparison
      if (sortBy === 'created_at') {
        compareA = new Date(compareA).getTime();
        compareB = new Date(compareB).getTime();
      }

      // Handle string comparison
      if (typeof compareA === 'string' && typeof compareB === 'string') {
        compareA = compareA.toLowerCase();
        compareB = compareB.toLowerCase();
      }

      if (compareA < compareB) return sortOrder === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [users, sortBy, sortOrder]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg shadow overflow-hidden">
        <div className="animate-pulse">
          <div className="h-12 bg-muted"></div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted border-t border-border"></div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (!users || users.length === 0) {
    return (
      <div className="bg-card rounded-lg shadow p-12 text-center">
        <p className="text-muted-foreground">No users found</p>
      </div>
    );
  }

  const SortIcon = ({ column }: { column: typeof sortBy }) => {
    if (sortBy !== column) {
      return <span className="text-muted-foreground">↕</span>;
    }
    return <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  const getRoleBadgeColor = (role: string) => {
    const color = getRoleColor(role);
    if (color === 'gold') return 'bg-gold text-foreground';
    if (color === 'blue') return 'bg-status-info-bg text-status-info';
    return 'bg-muted text-foreground';
  };

  return (
    <div className="bg-card rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-secondary-600">
          <tr>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-secondary-700"
              onClick={() => toggleSort('email')}
            >
              <div className="flex items-center gap-2">
                Email <SortIcon column="email" />
              </div>
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-secondary-700"
              onClick={() => toggleSort('full_name')}
            >
              <div className="flex items-center gap-2">
                Full Name <SortIcon column="full_name" />
              </div>
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-secondary-700"
              onClick={() => toggleSort('role')}
            >
              <div className="flex items-center gap-2">
                Role <SortIcon column="role" />
              </div>
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-secondary-700"
              onClick={() => toggleSort('created_at')}
            >
              <div className="flex items-center gap-2">
                Created At <SortIcon column="created_at" />
              </div>
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-border">
          {sortedUsers.map((user) => (
            <tr key={user.id} className="hover:bg-secondary-600/5 transition-colors">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                {user.email}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                {user.full_name}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 py-1 text-xs font-medium rounded ${getRoleBadgeColor(user.role)}`}>
                  {getRoleDisplayName(user.role)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                {formatDateTimeShort(user.created_at)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditFormOpen(true, user.id)}
                    className="text-accent hover:opacity-80"
                    style={{ minHeight: '36px', minWidth: '60px' }} // Touch target minimum
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirmOpen(true, user.id)}
                    className="text-status-error hover:opacity-80"
                    style={{ minHeight: '36px', minWidth: '60px' }} // Touch target minimum
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
