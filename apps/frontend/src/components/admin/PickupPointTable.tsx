'use client';

import { useMemo } from 'react';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import type { PickupPoint } from '@/lib/api/pickup-points';

interface PickupPointTableProps {
  pickupPoints: PickupPoint[];
  isLoading: boolean;
  userRole: string;
}

export const PickupPointTable = ({ pickupPoints, isLoading, userRole }: PickupPointTableProps) => {
  const { setEditFormOpen, setDeleteConfirmOpen } = usePickupPointStore();

  const columns: ColumnDef<PickupPoint>[] = useMemo(() => [
    { accessorKey: 'name', header: 'Nombre' },
    { accessorKey: 'code', header: 'Código' },
    { accessorKey: 'client_name', header: 'Cliente' },
    {
      accessorKey: 'pickup_locations',
      header: 'Ubicación',
      sortable: false,
      cell: (row) => {
        const loc = row.pickup_locations?.[0];
        return loc
          ? <span className="text-xs">{loc.address}</span>
          : <span className="text-xs text-muted-foreground">—</span>;
      },
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
          <button
            onClick={() => setEditFormOpen(true, row.id)}
            className="text-xs text-accent hover:underline"
          >
            Editar
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => setDeleteConfirmOpen(true, row.id)}
              className="text-xs text-[var(--color-status-error)] hover:underline"
            >
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
      data={(pickupPoints ?? []) as unknown as Record<string, unknown>[]}
      isLoading={isLoading}
      searchPlaceholder="Buscar por nombre, código o cliente..."
      emptyMessage="No hay puntos de retiro"
    />
  );
};
