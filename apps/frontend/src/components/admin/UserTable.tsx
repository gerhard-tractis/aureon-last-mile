'use client';

/**
 * User Table Component
 * Displays users in a DataTable with edit/delete actions
 */

import { useMemo } from 'react';
import { useAdminStore } from '@/stores/adminStore';
import { formatDateTimeShort } from '@/lib/utils/dateFormat';
import { getRoleDisplayName } from '@/lib/validation/userSchema';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import type { User } from '@/lib/api/users';

interface UserTableProps {
  users: User[];
  isLoading: boolean;
}

export const UserTable = ({ users, isLoading }: UserTableProps) => {
  const { setEditFormOpen, setDeleteConfirmOpen } = useAdminStore();

  const columns: ColumnDef<User>[] = useMemo(() => [
    {
      accessorKey: 'full_name',
      header: 'Nombre',
    },
    {
      accessorKey: 'email',
      header: 'Email',
    },
    {
      accessorKey: 'role',
      header: 'Rol',
      cell: (row) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-surface-raised)] text-[var(--color-text)]">
          {getRoleDisplayName(row.role)}
        </span>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Creado',
      cell: (row) => (
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {formatDateTimeShort(row.created_at)}
        </span>
      ),
    },
    {
      accessorKey: 'id',
      header: 'Acciones',
      sortable: false,
      cell: (row) => (
        <div className="flex gap-2">
          <button
            onClick={() => setEditFormOpen(true, row.id)}
            className="text-xs text-accent hover:underline"
          >
            Editar
          </button>
          <button
            onClick={() => setDeleteConfirmOpen(true, row.id)}
            className="text-xs text-[var(--color-status-error)] hover:underline"
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ], [setEditFormOpen, setDeleteConfirmOpen]);

  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>>[]}
      data={(users ?? []) as unknown as Record<string, unknown>[]}
      isLoading={isLoading}
      searchPlaceholder="Buscar por nombre o email..."
      emptyMessage="No hay usuarios"
    />
  );
};
