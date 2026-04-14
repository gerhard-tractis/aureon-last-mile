'use client';

import { useMemo } from 'react';
import { useClientStore } from '@/lib/stores/clientStore';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import type { Client } from '@/lib/api/clients';

interface ClientTableProps {
  clients: Client[];
  isLoading: boolean;
  userRole: string;
}

export const ClientTable = ({ clients, isLoading, userRole }: ClientTableProps) => {
  const { setEditFormOpen, setDeleteConfirmOpen } = useClientStore();

  const columns: ColumnDef<Client>[] = useMemo(() => [
    { accessorKey: 'name', header: 'Nombre' },
    { accessorKey: 'slug', header: 'Slug' },
    {
      accessorKey: 'pickup_point_count',
      header: 'Puntos de Retiro',
      cell: (row) => <span className="font-mono text-xs">{row.pickup_point_count ?? 0}</span>,
    },
    {
      accessorKey: 'is_active',
      header: 'Estado',
      cell: (row) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${row.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
          {row.is_active ? 'Activo' : 'Inactivo'}
        </span>
      ),
    },
    {
      accessorKey: 'id',
      header: 'Acciones',
      sortable: false,
      cell: (row) => (
        <div className="flex gap-2">
          <button onClick={() => setEditFormOpen(true, row.id)} className="text-xs text-accent hover:underline">
            Editar
          </button>
          {userRole === 'admin' && (
            <button onClick={() => setDeleteConfirmOpen(true, row.id)} className="text-xs text-[var(--color-status-error)] hover:underline">
              Eliminar
            </button>
          )}
        </div>
      ),
    },
  ], [setEditFormOpen, setDeleteConfirmOpen, userRole]);

  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>>[]}
      data={(clients ?? []) as unknown as Record<string, unknown>[]}
      isLoading={isLoading}
      searchPlaceholder="Buscar por nombre..."
      emptyMessage="No hay clientes"
    />
  );
};
