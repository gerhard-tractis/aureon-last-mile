'use client';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  entityName: string;
  itemName?: string;
  warningText?: string;
  isPending: boolean;
  isDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmationModal = ({
  isOpen,
  entityName,
  itemName,
  warningText,
  isPending,
  isDisabled = false,
  onConfirm,
  onCancel,
}: DeleteConfirmationModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-card rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Eliminar {entityName}
        </h2>

        <p className="text-foreground mb-4">
          {itemName
            ? `¿Estás seguro de que quieres eliminar ${entityName.toLowerCase()} "${itemName}"?`
            : `¿Estás seguro de que quieres eliminar este ${entityName.toLowerCase()}?`}
        </p>

        {warningText && (
          <div className="bg-[var(--color-status-warning-bg)] border border-[var(--color-status-warning-border)] rounded-md p-4 mb-6">
            <p className="text-sm text-[var(--color-text)]">
              <strong>Advertencia:</strong> {warningText}
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 border border-border rounded-md text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending || isDisabled}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPending && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {isPending ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
};
