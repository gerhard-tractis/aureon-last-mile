/**
 * TanStack Query hooks for user management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser, getUsers, updateUser, deleteUser, type CreateUserInput, type UpdateUserInput } from '@/lib/api/users';
import { toast } from 'sonner';

/**
 * useUsers - Query hook for fetching users list
 *
 * Automatically filtered by operator_id via RLS policy
 * Refetches on window focus and every 5 minutes in background
 */
export const useUsers = () => {
  return useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    staleTime: 60000, // Fresh for 60 seconds
    refetchInterval: 300000, // Background refresh every 5 minutes
    refetchOnWindowFocus: true
  });
};

/**
 * useCreateUser - Mutation hook for creating a new user
 *
 * On success: Invalidates users cache, shows success toast, closes modal
 * On error: Shows error toast with detailed message
 */
export const useCreateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createUser,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`User created successfully. Password setup email sent to ${data.email}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create user: ${error.message}`);
    }
  });
};

/**
 * useUpdateUser - Mutation hook for updating a user
 *
 * On success: Invalidates users cache, shows success toast
 * If role changed: Shows warning about re-authentication requirement
 * On error: Shows error toast with detailed message
 */
export const useUpdateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) => updateUser(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated successfully');

      // Warn if role changed (JWT claims won't update until re-auth)
      if (data.roleChanged) {
        toast.warning('User must re-authenticate to receive new role permissions', {
          duration: 5000
        });
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user: ${error.message}`);
    }
  });
};

/**
 * useDeleteUser - Mutation hook for deleting a user (soft delete)
 *
 * On success: Invalidates users cache, shows success toast
 * On error: Shows error toast with detailed message
 */
export const useDeleteUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete user: ${error.message}`);
    }
  });
};
