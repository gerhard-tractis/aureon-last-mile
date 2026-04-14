'use client';

import { useUsers, useDeleteUser } from '@/hooks/useUsers';
import { useAdminStore } from '@/lib/stores/adminStore';
import { UserListHeader } from './UserListHeader';
import { UserTable } from './UserTable';
import { UserForm } from './UserForm';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

export const UserManagementPage = () => {
  const { data: users, isLoading } = useUsers();
  const { isCreateFormOpen, isEditFormOpen, isDeleteConfirmOpen, selectedUserId, setDeleteConfirmOpen } = useAdminStore();
  const { mutate: deleteUser, isPending: isDeleting } = useDeleteUser();

  const handleDelete = () => {
    if (selectedUserId) {
      deleteUser(selectedUserId, {
        onSuccess: () => setDeleteConfirmOpen(false),
      });
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <UserListHeader />
        <UserTable users={users || []} isLoading={isLoading} />
        {isCreateFormOpen && <UserForm mode="create" />}
        {isEditFormOpen && selectedUserId && <UserForm mode="edit" userId={selectedUserId} />}
        <DeleteConfirmationModal
          isOpen={isDeleteConfirmOpen}
          entityName="Usuario"
          warningText="El usuario será desactivado (soft delete). Ya no podrá iniciar sesión. Esta acción puede revertirse."
          isPending={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      </div>
    </div>
  );
};
