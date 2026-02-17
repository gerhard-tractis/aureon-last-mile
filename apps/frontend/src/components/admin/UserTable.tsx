'use client';

/**
 * User Table Component
 * Displays users in a sortable table with edit/delete actions
 */

import { useMemo } from 'react';
import { format } from 'date-fns';
import { useAdminStore } from '@/stores/adminStore';
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
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="animate-pulse">
          <div className="h-12 bg-gray-200"></div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 border-t border-gray-200"></div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (!users || users.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <p className="text-gray-500">No users found</p>
      </div>
    );
  }

  const SortIcon = ({ column }: { column: typeof sortBy }) => {
    if (sortBy !== column) {
      return <span className="text-gray-400">↕</span>;
    }
    return <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  const getRoleBadgeColor = (role: string) => {
    const color = getRoleColor(role);
    if (color === 'gold') return 'bg-[#e6c15c] text-gray-900';
    if (color === 'blue') return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-[#5e6b7b]">
          <tr>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#4e5b6b]"
              onClick={() => toggleSort('email')}
            >
              <div className="flex items-center gap-2">
                Email <SortIcon column="email" />
              </div>
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#4e5b6b]"
              onClick={() => toggleSort('full_name')}
            >
              <div className="flex items-center gap-2">
                Full Name <SortIcon column="full_name" />
              </div>
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#4e5b6b]"
              onClick={() => toggleSort('role')}
            >
              <div className="flex items-center gap-2">
                Role <SortIcon column="role" />
              </div>
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#4e5b6b]"
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
        <tbody className="bg-white divide-y divide-gray-200">
          {sortedUsers.map((user) => (
            <tr key={user.id} className="hover:bg-[#5e6b7b]/5 transition-colors">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {user.email}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                {user.full_name}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 py-1 text-xs font-medium rounded ${getRoleBadgeColor(user.role)}`}>
                  {getRoleDisplayName(user.role)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                {format(new Date(user.created_at), 'dd/MM/yyyy HH:mm')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditFormOpen(true, user.id)}
                    className="text-blue-600 hover:text-blue-800"
                    style={{ minHeight: '36px', minWidth: '60px' }} // Touch target minimum
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirmOpen(true, user.id)}
                    className="text-red-600 hover:text-red-800"
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
