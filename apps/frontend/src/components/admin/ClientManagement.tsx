'use client';

import { useClients, useDeleteClient } from '@/hooks/useClients';
import { useClientStore } from '@/lib/stores/clientStore';
import { ClientTable } from './ClientTable';
import { ClientForm } from './ClientForm';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

interface ClientManagementProps {
  userRole: string;
}

export const ClientManagement = ({ userRole }: ClientManagementProps) => {
  const { data: clients, isLoading } = useClients();
  const { isCreateFormOpen, isEditFormOpen, selectedClientId, isDeleteConfirmOpen, setCreateFormOpen, setDeleteConfirmOpen } = useClientStore();
  const { mutate: deleteClient, isPending: isDeleting } = useDeleteClient();

  const handleDelete = () => {
    if (selectedClientId) {
      deleteClient(selectedClientId, {
        onSuccess: () => setDeleteConfirmOpen(false),
      });
    }
  };

  const selectedClient = clients?.find((c) => c.id === selectedClientId);
  const hasActivePickupPoints = (selectedClient?.pickup_point_count ?? 0) > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Clientes</h2>
          <p className="text-sm text-muted-foreground mt-1">Crear y administrar clientes</p>
        </div>
        <button
          onClick={() => setCreateFormOpen(true)}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 font-medium"
          style={{ minHeight: '44px' }}
        >
          Nuevo Cliente
        </button>
      </div>

      <ClientTable clients={clients || []} isLoading={isLoading} userRole={userRole} />

      {isCreateFormOpen && <ClientForm mode="create" />}
      {isEditFormOpen && selectedClientId && <ClientForm mode="edit" clientId={selectedClientId} />}

      <DeleteConfirmationModal
        isOpen={isDeleteConfirmOpen}
        entityName="Cliente"
        itemName={selectedClient?.name}
        warningText={hasActivePickupPoints
          ? `Este cliente tiene ${selectedClient?.pickup_point_count} punto(s) de retiro activo(s). Deben ser eliminados o desactivados primero.`
          : undefined}
        isPending={isDeleting}
        isDisabled={hasActivePickupPoints}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
};
