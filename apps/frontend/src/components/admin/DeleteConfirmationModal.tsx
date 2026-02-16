'use client';

/**
 * Delete Confirmation Modal
 * Shows warning about soft delete and confirms user deletion
 */

import { useDeleteUser } from '@/hooks/useUsers';
import { useAdminStore } from '@/stores/adminStore';

export const DeleteConfirmationModal = () => {
  const { isDeleteConfirmOpen, selectedUserId, setDeleteConfirmOpen } = useAdminStore();
  const { mutate: deleteUser, isPending } = useDeleteUser();

  if (!isDeleteConfirmOpen) return null;

  const handleDelete = () => {
    if (selectedUserId) {
      deleteUser(selectedUserId, {
        onSuccess: () => {
          setDeleteConfirmOpen(false);
        }
      });
    }
  };

  const handleCancel = () => {
    setDeleteConfirmOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Delete User
        </h2>

        <p className="text-gray-700 mb-4">
          Are you sure you want to delete this user?
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-6">
          <p className="text-sm text-amber-800">
            <strong>Warning:</strong> User will be soft-deleted (sets deleted_at timestamp).
            They can no longer log in. This action can be reversed by setting deleted_at = NULL
            in the database.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPending && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};
