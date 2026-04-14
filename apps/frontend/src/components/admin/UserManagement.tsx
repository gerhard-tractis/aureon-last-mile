'use client';

import { useUsers, useDeleteUser } from '@/hooks/useUsers';
import { useAdminStore } from '@/lib/stores/adminStore';
import { UserListHeader } from './UserListHeader';
import { UserTable } from './UserTable';
import { UserForm } from './UserForm';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

interface UserManagementProps {
  userRole: string;
}

export const UserManagement = ({ userRole }: UserManagementProps) => {
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
    <div>
      <UserListHeader />
      <UserTable users={users || []} isLoading={isLoading} userRole={userRole} />
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
  );
};
