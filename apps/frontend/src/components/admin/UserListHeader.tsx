'use client';

/**
 * User List Header
 * Displays page title and Create User button
 */

import { useAdminStore } from '@/stores/adminStore';

export const UserListHeader = () => {
  const { setCreateFormOpen } = useAdminStore();

  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">User Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create and manage user accounts and roles
        </p>
      </div>

      <button
        onClick={() => setCreateFormOpen(true)}
        className="px-4 py-2 bg-gold text-foreground rounded-md hover:bg-primary-600 font-medium transition-colors"
        style={{ minHeight: '44px' }} // Touch target minimum
      >
        Create User
      </button>
    </div>
  );
};
