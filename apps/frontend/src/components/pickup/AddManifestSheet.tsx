'use client';

import { Loader2, Package } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/EmptyState';

export interface PickableManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_packages: number | null;
}

interface AddManifestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifests: PickableManifest[];
  isLoading?: boolean;
  isAdding?: boolean;
  onPick: (manifestId: string) => void;
}

/**
 * Modal picker listing unassigned manifests (no pickup_route_id, status=pending).
 * Tap → `onPick(manifest.id)` → parent calls add_manifest_to_route RPC and
 * closes the sheet on success.
 */
export function AddManifestSheet({
  open,
  onOpenChange,
  manifests,
  isLoading = false,
  isAdding = false,
  onPick,
}: AddManifestSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar manifiesto</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          </div>
        ) : manifests.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Sin manifiestos disponibles"
            description="No hay manifiestos sin asignar a una ruta."
          />
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto"
              data-testid="pickable-manifest-list">
            {manifests.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={isAdding}
                  onClick={() => onPick(m.id)}
                  className="w-full p-3 text-left hover:bg-accent-muted/30 disabled:opacity-50"
                >
                  <p className="font-semibold text-text truncate">
                    {m.retailer_name ?? 'Retailer desconocido'}
                  </p>
                  <p className="font-mono text-xs text-text-secondary">
                    {m.external_load_id} · {m.total_packages ?? 0} paquetes
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
