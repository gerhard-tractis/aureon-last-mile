'use client';

import { usePickupPoints, useDeletePickupPoint } from '@/hooks/usePickupPoints';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { PickupPointTable } from './PickupPointTable';
import { PickupPointForm } from './PickupPointForm';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

interface PickupPointManagementProps {
  userRole: string;
}

export const PickupPointManagement = ({ userRole }: PickupPointManagementProps) => {
  const { data: points, isLoading } = usePickupPoints();
  const {
    isCreateFormOpen,
    isEditFormOpen,
    selectedPickupPointId,
    isDeleteConfirmOpen,
    setCreateFormOpen,
    setDeleteConfirmOpen,
  } = usePickupPointStore();
  const { mutate: deletePoint, isPending: isDeleting } = useDeletePickupPoint();

  const handleDelete = () => {
    if (selectedPickupPointId) {
      deletePoint(selectedPickupPointId, {
        onSuccess: () => setDeleteConfirmOpen(false),
      });
    }
  };

  const selectedPoint = points?.find((p) => p.id === selectedPickupPointId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Puntos de Retiro</h2>
          <p className="text-sm text-muted-foreground mt-1">Crear y administrar puntos de retiro</p>
        </div>
        <button
          onClick={() => setCreateFormOpen(true)}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 font-medium"
          style={{ minHeight: '44px' }}
        >
          Nuevo Punto de Retiro
        </button>
      </div>

      <PickupPointTable
        pickupPoints={points ?? []}
        isLoading={isLoading}
        userRole={userRole}
      />

      {isCreateFormOpen && <PickupPointForm mode="create" />}
      {isEditFormOpen && selectedPickupPointId && (
        <PickupPointForm mode="edit" pointId={selectedPickupPointId} />
      )}

      <DeleteConfirmationModal
        isOpen={isDeleteConfirmOpen}
        entityName="Punto de Retiro"
        itemName={selectedPoint ? `${selectedPoint.name} (${selectedPoint.code})` : undefined}
        warningText="El punto de retiro será desactivado (soft delete). Esta acción se puede revertir."
        isPending={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
};
