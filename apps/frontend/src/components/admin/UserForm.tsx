'use client';

/**
 * User Form Component
 * Handles both creating new users and editing existing users
 * Uses React Hook Form + Zod for validation
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAdminStore } from '@/stores/adminStore';
import { useCreateUser, useUpdateUser, useUsers } from '@/hooks/useUsers';
import { createUserSchema, updateUserSchema, roleOptions, type CreateUserFormData, type UpdateUserFormData } from '@/lib/validation/userSchema';

interface UserFormProps {
  mode: 'create' | 'edit';
  userId?: string;
}

export const UserForm = ({ mode, userId }: UserFormProps) => {
  if (mode === 'create') {
    return <CreateUserFormInternal />;
  } else {
    return <EditUserFormInternal userId={userId!} />;
  }
};

// Separate component for creating users
const CreateUserFormInternal = () => {
  const { setCreateFormOpen } = useAdminStore();
  const { data: users } = useUsers();
  const { mutate: createUser, isPending } = useCreateUser();
  const [emailCheckError, setEmailCheckError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch
  } = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
  });

  const emailValue = watch('email');

  // Async email uniqueness check (debounced)
  useEffect(() => {
    if (!emailValue) {
      setEmailCheckError(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      const emailExists = users?.some(u => u.email.toLowerCase() === emailValue.toLowerCase());
      if (emailExists) {
        setEmailCheckError('Email already in use');
      } else {
        setEmailCheckError(null);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [emailValue, users]);

  const onSubmit = (data: CreateUserFormData) => {
    if (emailCheckError) return;

    createUser(data, {
      onSuccess: () => {
        setCreateFormOpen(false);
        reset();
      }
    });
  };

  const handleCancel = () => {
    setCreateFormOpen(false);
    reset();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Create New User</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email field */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email *
            </label>
            <input
              id="email"
              type="email"
              {...register('email')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.email || emailCheckError ? 'email-error' : undefined}
              aria-invalid={!!(errors.email || emailCheckError)}
            />
            {errors.email && (
              <p id="email-error" className="mt-1 text-sm text-red-600" role="alert">
                {errors.email.message}
              </p>
            )}
            {emailCheckError && (
              <p id="email-error" className="mt-1 text-sm text-red-600" role="alert">
                {emailCheckError}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              User will receive a password setup email
            </p>
          </div>

          {/* Full Name field */}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-1">
              Full Name *
            </label>
            <input
              id="full_name"
              type="text"
              {...register('full_name')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.full_name ? 'full_name-error' : undefined}
              aria-invalid={!!errors.full_name}
            />
            {errors.full_name && (
              <p id="full_name-error" className="mt-1 text-sm text-red-600" role="alert">
                {errors.full_name.message}
              </p>
            )}
          </div>

          {/* Role field */}
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
              Role *
            </label>
            <select
              id="role"
              {...register('role')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.role ? 'role-error' : undefined}
              aria-invalid={!!errors.role}
            >
              <option value="">Select a role</option>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.role && (
              <p id="role-error" className="mt-1 text-sm text-red-600" role="alert">
                {errors.role.message}
              </p>
            )}
          </div>

          {/* Operator ID field */}
          <div>
            <label htmlFor="operator_id" className="block text-sm font-medium text-gray-700 mb-1">
              Operator ID *
            </label>
            <input
              id="operator_id"
              type="text"
              {...register('operator_id')}
              disabled={isPending}
              placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.operator_id ? 'operator_id-error' : undefined}
              aria-invalid={!!errors.operator_id}
            />
            {errors.operator_id && (
              <p id="operator_id-error" className="mt-1 text-sm text-red-600" role="alert">
                {errors.operator_id.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              UUID of the operator this user belongs to
            </p>
          </div>

          {/* Form actions */}
          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !!emailCheckError}
              className="px-4 py-2 bg-[#e6c15c] text-gray-900 rounded-md hover:bg-[#d4b04a] font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPending && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Separate component for editing users
const EditUserFormInternal = ({ userId }: { userId: string }) => {
  const { setEditFormOpen } = useAdminStore();
  const { data: users } = useUsers();
  const { mutate: updateUser, isPending } = useUpdateUser();

  const user = users?.find(u => u.id === userId);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: user ? {
      full_name: user.full_name,
      role: user.role as UpdateUserFormData['role']
    } : undefined
  });

  useEffect(() => {
    if (user) {
      reset({
        full_name: user.full_name,
        role: user.role as UpdateUserFormData['role']
      });
    }
  }, [user, reset]);

  const onSubmit = (data: UpdateUserFormData) => {
    updateUser(
      { id: userId, data },
      {
        onSuccess: () => {
          setEditFormOpen(false);
        }
      }
    );
  };

  const handleCancel = () => {
    setEditFormOpen(false);
  };

  if (!user) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Edit User</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Show email as read-only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <div className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-gray-600">
              {user.email}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Email cannot be changed
            </p>
          </div>

          {/* Full Name field */}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-1">
              Full Name *
            </label>
            <input
              id="full_name"
              type="text"
              {...register('full_name')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.full_name ? 'full_name-error' : undefined}
              aria-invalid={!!errors.full_name}
            />
            {errors.full_name && (
              <p id="full_name-error" className="mt-1 text-sm text-red-600" role="alert">
                {errors.full_name.message}
              </p>
            )}
          </div>

          {/* Role field */}
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
              Role *
            </label>
            <select
              id="role"
              {...register('role')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.role ? 'role-error' : undefined}
              aria-invalid={!!errors.role}
            >
              <option value="">Select a role</option>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.role && (
              <p id="role-error" className="mt-1 text-sm text-red-600" role="alert">
                {errors.role.message}
              </p>
            )}
          </div>

          {/* Show operator_id as read-only */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Operator ID
            </label>
            <div className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-gray-600 text-sm font-mono">
              {user.operator_id}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Operator ID cannot be changed
            </p>
          </div>

          {/* Form actions */}
          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-[#e6c15c] text-gray-900 rounded-md hover:bg-[#d4b04a] font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPending && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
