'use client';

/**
 * User Form Component
 * Handles both creating new users and editing existing users
 * Uses React Hook Form + Zod for validation
 * Rendered inside a shadcn Sheet (slide-out from right)
 */

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAdminStore } from '@/lib/stores/adminStore';
import { useCreateUser, useUpdateUser, useUsers } from '@/hooks/useUsers';
import {
  createUserSchema,
  updateUserSchema,
  roleOptions,
  permissionOptions,
  type CreateUserFormData,
  type UpdateUserFormData,
} from '@/lib/validation/userSchema';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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

function PermissionsField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const toggle = (perm: string) => {
    if (value.includes(perm)) {
      onChange(value.filter((p) => p !== perm));
    } else {
      onChange([...value, perm]);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        Permisos
      </label>
      <div className="space-y-2">
        {permissionOptions.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-2 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              checked={value.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              disabled={disabled}
              className="h-4 w-4 rounded border-border accent-accent disabled:opacity-50"
            />
            <span className="text-sm text-foreground">{opt.label}</span>
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Selecciona los módulos a los que tendrá acceso este usuario.
      </p>
    </div>
  );
}

// Separate component for creating users
const CreateUserFormInternal = () => {
  const { setCreateFormOpen } = useAdminStore();
  const { data: users } = useUsers();
  const { mutate: createUser, isPending } = useCreateUser();
  const [emailCheckError, setEmailCheckError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    reset,
    watch,
  } = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { permissions: [] },
  });

  const emailValue = watch('email');

  // Async email uniqueness check (debounced)
  useEffect(() => {
    if (!emailValue) {
      setEmailCheckError(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      const emailExists = users?.some(
        (u) => u.email.toLowerCase() === emailValue.toLowerCase()
      );
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
      },
    });
  };

  const handleCancel = () => {
    setCreateFormOpen(false);
    reset();
  };

  return (
    <Sheet
      open={true}
      onOpenChange={(open) => {
        if (!open) setCreateFormOpen(false);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Crear Usuario</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          {/* Email */}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Email *
            </label>
            <input
              id="email"
              type="email"
              {...register('email')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-border rounded-md bg-surface text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.email || emailCheckError ? 'email-error' : undefined}
              aria-invalid={!!(errors.email || emailCheckError)}
            />
            {errors.email && (
              <p id="email-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {errors.email.message}
              </p>
            )}
            {emailCheckError && (
              <p id="email-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {emailCheckError}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              El usuario recibirá un email para configurar su contraseña.
            </p>
          </div>

          {/* Full Name */}
          <div>
            <label
              htmlFor="full_name"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Nombre completo *
            </label>
            <input
              id="full_name"
              type="text"
              {...register('full_name')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-border rounded-md bg-surface text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.full_name ? 'full_name-error' : undefined}
              aria-invalid={!!errors.full_name}
            />
            {errors.full_name && (
              <p id="full_name-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {errors.full_name.message}
              </p>
            )}
          </div>

          {/* Role */}
          <div>
            <label
              htmlFor="role"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Rol *
            </label>
            <select
              id="role"
              {...register('role')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-border rounded-md bg-surface text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.role ? 'role-error' : undefined}
              aria-invalid={!!errors.role}
            >
              <option value="">Seleccionar rol</option>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.role && (
              <p id="role-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {errors.role.message}
              </p>
            )}
          </div>

          {/* Permissions */}
          <Controller
            name="permissions"
            control={control}
            render={({ field }) => (
              <PermissionsField
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={isPending}
              />
            )}
          />

          {/* Operator ID */}
          <div>
            <label
              htmlFor="operator_id"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Operator ID *
            </label>
            <input
              id="operator_id"
              type="text"
              {...register('operator_id')}
              disabled={isPending}
              placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
              className="w-full px-3 py-2 border border-border rounded-md bg-surface text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.operator_id ? 'operator_id-error' : undefined}
              aria-invalid={!!errors.operator_id}
            />
            {errors.operator_id && (
              <p id="operator_id-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {errors.operator_id.message}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              UUID del operador al que pertenece este usuario.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="px-4 py-2 border border-border rounded-md text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending || !!emailCheckError}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPending && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isPending ? 'Creando...' : 'Crear Usuario'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

// Separate component for editing users
const EditUserFormInternal = ({ userId }: { userId: string }) => {
  const { setEditFormOpen } = useAdminStore();
  const { data: users } = useUsers();
  const { mutate: updateUser, isPending } = useUpdateUser();

  const user = users?.find((u) => u.id === userId);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    reset,
  } = useForm<UpdateUserFormData>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: user
      ? {
          full_name: user.full_name,
          role: user.role as UpdateUserFormData['role'],
          permissions: (user.permissions ?? []) as UpdateUserFormData['permissions'],
        }
      : undefined,
  });

  useEffect(() => {
    if (user) {
      reset({
        full_name: user.full_name,
        role: user.role as UpdateUserFormData['role'],
        permissions: (user.permissions ?? []) as UpdateUserFormData['permissions'],
      });
    }
  }, [user, reset]);

  const onSubmit = (data: UpdateUserFormData) => {
    updateUser(
      { id: userId, data },
      {
        onSuccess: () => {
          setEditFormOpen(false);
        },
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
    <Sheet
      open={true}
      onOpenChange={(open) => {
        if (!open) setEditFormOpen(false);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Editar Usuario</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          {/* Email — read-only */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Email
            </label>
            <div className="w-full px-3 py-2 border border-border rounded-md bg-muted text-muted-foreground">
              {user.email}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              El email no se puede cambiar.
            </p>
          </div>

          {/* Full Name */}
          <div>
            <label
              htmlFor="full_name"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Nombre completo *
            </label>
            <input
              id="full_name"
              type="text"
              {...register('full_name')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-border rounded-md bg-surface text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.full_name ? 'full_name-error' : undefined}
              aria-invalid={!!errors.full_name}
            />
            {errors.full_name && (
              <p id="full_name-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {errors.full_name.message}
              </p>
            )}
          </div>

          {/* Role */}
          <div>
            <label
              htmlFor="role"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Rol *
            </label>
            <select
              id="role"
              {...register('role')}
              disabled={isPending}
              className="w-full px-3 py-2 border border-border rounded-md bg-surface text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={errors.role ? 'role-error' : undefined}
              aria-invalid={!!errors.role}
            >
              <option value="">Seleccionar rol</option>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.role && (
              <p id="role-error" className="mt-1 text-sm text-[var(--color-status-error)]" role="alert">
                {errors.role.message}
              </p>
            )}
          </div>

          {/* Permissions */}
          <Controller
            name="permissions"
            control={control}
            render={({ field }) => (
              <PermissionsField
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={isPending}
              />
            )}
          />

          {/* Operator ID — read-only */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Operator ID
            </label>
            <div className="w-full px-3 py-2 border border-border rounded-md bg-muted text-muted-foreground text-sm font-mono">
              {user.operator_id}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="px-4 py-2 border border-border rounded-md text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPending && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isPending ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};
