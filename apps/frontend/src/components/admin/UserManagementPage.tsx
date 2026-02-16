'use client';

/**
 * User Management Page Component
 * Main container for the user management interface
 * Orchestrates all admin components and handles data fetching
 */

import { useUsers } from '@/hooks/useUsers';
import { useAdminStore } from '@/stores/adminStore';
import { UserListHeader } from './UserListHeader';
import { UserTable } from './UserTable';
import { UserForm } from './UserForm';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

export const UserManagementPage = () => {
  const { data: users, isLoading } = useUsers();
  const { isCreateFormOpen, isEditFormOpen, selectedUserId } = useAdminStore();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <UserListHeader />

        <UserTable users={users || []} isLoading={isLoading} />

        {/* Create User Modal */}
        {isCreateFormOpen && <UserForm mode="create" />}

        {/* Edit User Modal */}
        {isEditFormOpen && selectedUserId && (
          <UserForm mode="edit" userId={selectedUserId} />
        )}

        {/* Delete Confirmation Modal */}
        <DeleteConfirmationModal />
      </div>
    </div>
  );
};
